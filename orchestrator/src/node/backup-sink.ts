// M3-C — remote backup sink (Tier M, above the Freeze Surface). A backup directory (full, an
// incremental chain link, or a compacted set) is a flat set of files; a SINK abstracts where those
// bytes live. `pushDir`/`pullDir` move a backup dir to/from any sink, so backup→sink→restore reproduces
// node@t (SC-3). The offline close uses LocalDirSink (a directory standing in for "remote"); a real
// off-host provider is the SAME interface (async put/get/list) and is the gated, optional leg.
//
// Transport only — opaque bytes. The restore + verification (and thus all root checks) stay in the
// proven backup/restore functions; this layer never interprets state. No Freeze Surface impact.

import fs from "node:fs";
import path from "node:path";
import { BackupError } from "./backup.js";

export { BackupError } from "./backup.js";

/** A content sink for backup bytes. Async so a real off-host provider (S3-like) is a drop-in impl. */
export interface BackupSink {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  list(prefix?: string): Promise<string[]>;
  has(key: string): Promise<boolean>;
}

/** Offline sink: keys are stored as files under `root` ('/' in a key ⇒ nested dirs). Stands in for a
 *  remote provider in tests + local operation; a real provider implements the same interface. */
export class LocalDirSink implements BackupSink {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  private resolve(key: string): string {
    const p = path.join(this.root, key);
    if (!path.resolve(p).startsWith(path.resolve(this.root))) throw new BackupError(`sink key escapes the root: ${key}`);
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.resolve(key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  async get(key: string): Promise<Buffer> {
    const p = this.resolve(key);
    if (!fs.existsSync(p)) throw new BackupError(`sink has no object: ${key}`);
    return fs.readFileSync(p);
  }
  async has(key: string): Promise<boolean> {
    return fs.existsSync(this.resolve(key));
  }
  async list(prefix = ""): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string, rel: string) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const key = rel ? `${rel}/${name}` : name;
        if (fs.statSync(abs).isDirectory()) walk(abs, key);
        else if (key.startsWith(prefix)) out.push(key);
      }
    };
    walk(this.root, "");
    return out.sort();
  }
}

/** Upload every (flat) file of a backup dir under `namespace/`. Returns the keys written. */
export async function pushDir(srcDir: string, sink: BackupSink, namespace: string): Promise<string[]> {
  if (!fs.existsSync(srcDir)) throw new BackupError(`no such backup dir: ${srcDir}`);
  const keys: string[] = [];
  for (const name of fs.readdirSync(srcDir)) {
    const abs = path.join(srcDir, name);
    if (!fs.statSync(abs).isFile()) continue; // backup dirs are flat
    const key = `${namespace}/${name}`;
    await sink.put(key, fs.readFileSync(abs));
    keys.push(key);
  }
  if (keys.length === 0) throw new BackupError(`backup dir is empty: ${srcDir}`);
  return keys.sort();
}

/** Download every object under `namespace/` into a fresh `destDir`, reproducing the backup dir. */
export async function pullDir(sink: BackupSink, namespace: string, destDir: string): Promise<void> {
  const prefix = `${namespace}/`;
  const keys = (await sink.list(prefix)).filter((k) => k.startsWith(prefix));
  if (keys.length === 0) throw new BackupError(`sink has no objects under ${prefix}`);
  fs.mkdirSync(destDir, { recursive: true });
  for (const key of keys) {
    const name = key.slice(prefix.length);
    if (name.includes("/")) throw new BackupError(`unexpected nested key under ${prefix}: ${key}`);
    fs.writeFileSync(path.join(destDir, name), await sink.get(key));
  }
}
