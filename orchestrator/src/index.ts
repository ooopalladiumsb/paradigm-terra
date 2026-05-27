/**
 * @paradigm-terra/orchestrator — deterministic multi-tick node.
 *
 * Folds a program of per-tick CAL submissions through validator -> reducer over one
 * evolving State; records per-event STATE_ROOT and the CE §6.3 global stream Merkle
 * root; byte-for-byte replayable. See ./node.ts and ../../docs/notes/orchestrator-design.md.
 */
export * from "./node.js";
