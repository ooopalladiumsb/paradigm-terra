# M3 Charter — durability (incremental + WAL archival/compaction + remote sink)

**Date:** 2026-06-10 · **Status:** charter / pre-registration (no code). Post-release v1.x maintenance
line, **Tier M** (above the Freeze Surface). Follows M1 (CI runner) and M2 (Registry reconciliation,
SC-3 verified live). Ratify before the first M3 PR — same discipline as the M2 charter / PP#2
pre-registration: pin scope, success criteria, and failure taxonomy in advance.

## 0. Architect ruling (the boundary this charter encodes)

Ruled 2026-06-10. M3 extends PR-1.7's **local** backup→restore (`src/node/backup.ts`, the Backup
Equivalence invariant) to the set PR-1.7 explicitly deferred — *incremental*, *remote/off-host*, and
*WAL archival/compaction*:

```
Role:           durability extension of the proven local backup→restore
Stages:         A incremental · B WAL archival/compaction · C remote sink (gated)
Mode:           offline-first (real-cloud leg gated, non-blocking — the M2-C pattern)
Tier:           M (maintenance)
Freeze Surface: immutable
```

Unlike M2, durability has **no Tier-C tripwire**: backup transport and WAL compaction never touch
consensus / validator / reducer / gas / canonicalization. The risk here is **correctness**, not version
escalation — compaction must not break byte-exact replay; incremental/remote must not drop bytes. The
Tier-M guarantee is therefore PR-1.7's invariant, preserved and extended (§4).

## 1. The one rule

Per `roadmap-v1.x.md`, an item is Tier M iff `freeze-gate` would not move. M3 touches only the
operational durability layer (`src/node/*`, above the Freeze Surface §8.3) — no normative artifact, no
`cal/validator/reducer/canonicalization/economics` edit. The acceptance bar is mechanical and identical
to PR-1.7's: a restored / compacted / remotely-round-tripped node must reproduce the **same roots**
(`STATE_ROOT, GLOBAL_ROOT, EVENT_COUNT, LAST_EVENT_HASH`) and recovery path as the original.

## 2. Scope

### IN (M3, Tier M)
- **Incremental backup** — base + WAL-delta capture on top of PR-1.7's full backup; `restore(base ⊕
  deltas)` reproduces `node@t` exactly.
- **WAL archival / compaction** — archive/compact the event log *behind snapshots* without breaking
  §7.2 byte-exact replay (the durable WAL prefix / `wal_size_bytes` boundary and `wal_offset` line
  boundaries from `backup.ts` are honoured; the root values are unchanged).
- **Remote / off-host sink** — a backup **sink interface** so a backup can target an off-host
  destination; verified offline against a local "remote" directory. A real cloud provider is a **gated,
  optional** leg (needs access), never a blocker.
- **Negative controls** — extend PR-1.7's table: a corrupt/missing delta or archive segment either
  hard-fails (`BackupError`) or degrades gracefully to a full-WAL replay (Rule 1), never a silent wrong
  state.

### OUT (later / not M3)
- Any `cal / validator / reducer / canonicalization / economics` change (Freeze Surface).
- **Encryption** and **versioned-retention policy** — a separate future maintenance item; M3 stays narrow.
- A real cloud provider as a *required* dependency — the remote leg is abstracted + gated (offline closes M3).

## 3. Stages (offline-first; the real-remote leg is gated, not on the critical path)

```
M3-A  Incremental backup
        - capture base + WAL deltas (snapshot + the WAL bytes since the last backup boundary);
          restore folds base then deltas. Reuses backupNode/restoreNode + BackupManifest.
M3-B  WAL archival / compaction
        - archive/compact events behind a snapshot's wal_offset; the live WAL keeps only the tail.
          Replay from the compacted set == replay from the full WAL (identical roots).
M3-C  Remote sink  [real cloud GATED on access — optional, non-blocking]
        - a sink abstraction (put/get/list); offline-tested against a local directory sink. If real
          off-host access exists, the same sink drives it; otherwise M3 closes on M3-A + M3-B + the
          local-sink M3-C.
```

## 4. Success criteria (M3 PASSES iff all hold; pinned in advance)

```
SC-1  Incremental round-trip — restore(base ⊕ deltas) == node@t on all 7 quantities
        (STATE_ROOT · GLOBAL_ROOT · EVENT_COUNT · LAST_EVENT_HASH · RECOVERY_MODE · COVERED_TICK · WAL_OFFSET),
        a direct extension of PR-1.7 Backup Equivalence.
SC-2  Compaction preserves replay — replay-from-compacted-WAL == replay-from-full-WAL (identical roots);
        on-disk WAL growth is bounded behind snapshots.
SC-3  Remote-sink round-trip — backup→sink→restore reproduces node@t against a local sink (offline);
        the real-cloud leg is gated/optional and does not gate SC-3's close.
SC-4  No Freeze Surface movement (no cal/validator/reducer/canonicalization/economics edit).
SC-5  freeze-gate remains byte-identical (vectors NORMATIVE + Proof Package #1 reproduce in TS and Go).
```

SC-4/SC-5 are the Tier-M guarantee, checked the way CI checks the freeze. The real-cloud remote leg is
**not** an SC — its absence does not fail M3; its presence strengthens SC-3 from local-sink to off-host.

## 5. Failure taxonomy (decided in advance)

Because M3 only adds durability *transport and compaction* over an already-proven state pipeline, a
failure is one of two things — never a consensus event:

- **Durability-layer defect** (our bug: a bad delta fold, a compaction that drops/reorders events, a
  sink put/get mismatch): the restored/compacted state ≠ the original roots → hard-fail (`BackupError`)
  or a detected mismatch. Fix in M3 code; freeze intact. Expected class for any SC-1/SC-2/SC-3 miss.
- **Environmental** (a real off-host transport hiccup — network, credentials, rate limit, like M2-C's
  toncenter rate-limit): localized to the gated remote leg, surfaced and retried; the offline core and
  its roots are untouched. Discriminator: did the bytes round-trip faithfully? An unfaithful round-trip
  ⇒ our bug; a faithful one that the transport couldn't deliver ⇒ environmental.

Neither can move the Freeze Surface: the roots are derived from the frozen pipeline and are merely
copied/compacted/shipped here.

## 6. Branch policy

Working branch: **`post-release/m3-durability`** (off `main`, like M1/M2). M3-A/M3-B/M3-C-local land as
ordinary operational PRs up to `main` (branch-protected: 4 required checks + `enforce_admins`). A real
off-host sink's artifacts attach only when access exists and never gate the offline close.

## 7. Related
- `pr1.7-backup-restore.md` / `src/node/backup.ts` — the local backup→restore + Backup Equivalence M3 extends (it deferred incremental/remote/archival to "post-1.9" — that is M3).
- `pr1.2c-snapshot-design.md` — the snapshot Truth / ahead-of-WAL rules compaction must honour.
- `pr1.3-recovery-sla.md` / `src/node/persistent-node.ts` — the WAL (fsync'd NDJSON, `wal_offset` line boundaries, tail-seek recovery) M3-A/B operate on.
- `roadmap-v1.x.md` — the Tier M items M3 fulfils (remote/incremental backups · WAL archival/compaction).
- `m2-charter.md` — the charter→ratify→staged-code pattern M3 follows.
