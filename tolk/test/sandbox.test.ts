/**
 * L2.0 — the harness behavior axis. Deploys the golden-compiled example-counter in @ton/sandbox and
 * exercises its entry points (op::increment) + getter (counter), asserting on-chain state. This is the
 * TVM-trace axis every Layer-2 contract inherits (the PP#3/PP#5 sandbox pattern). Offline, no network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { beginCell, Cell, contractAddress, toNano } from "@ton/core";
import { Blockchain } from "@ton/sandbox";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "example-counter.compiled.json"), "utf8"));
const code = Cell.fromBase64(golden.codeBoc64);

const OP_INCREMENT = 0x696e6301;
const initialData = (counter: bigint) => beginCell().storeUint(counter, 64).endCell();
const incrementBody = (by: bigint) => beginCell().storeUint(OP_INCREMENT, 32).storeUint(by, 64).endCell();

test("L2.0: deploy + op::increment moves the counter, getter reads it back (sandbox)", async () => {
  const bc = await Blockchain.create();
  const sender = await bc.treasury("sender");

  const data = initialData(0n);
  const addr = contractAddress(0, { code, data });

  // deploy (stateInit) + first increment in one message
  await sender.send({ to: addr, value: toNano("0.5"), init: { code, data }, body: incrementBody(5n) });
  const read = async () => (await bc.runGetMethod(addr, "counter", [])).stackReader.readBigNumber();
  assert.equal(await read(), 5n, "counter == 5 after increment(5)");

  // a second increment accumulates
  await sender.send({ to: addr, value: toNano("0.05"), body: incrementBody(3n) });
  assert.equal(await read(), 8n, "counter == 8 after increment(3)");
});

test("L2.0: an unknown op aborts (exit 0xffff), state unchanged", async () => {
  const bc = await Blockchain.create();
  const sender = await bc.treasury("sender");
  const data = initialData(7n);
  const addr = contractAddress(0, { code, data });
  await sender.send({ to: addr, value: toNano("0.5"), init: { code, data }, body: incrementBody(0n) }); // deploy
  const res = await sender.send({ to: addr, value: toNano("0.05"), body: beginCell().storeUint(0xdead, 32).endCell() });
  assert.ok(
    res.transactions.some((t) => t.description.type === "generic" && t.description.computePhase.type === "vm" && t.description.computePhase.exitCode === 0xffff),
    "unknown op aborts with exit 0xffff",
  );
  assert.equal((await bc.runGetMethod(addr, "counter", [])).stackReader.readBigNumber(), 7n, "state unchanged after a rejected op");
});
