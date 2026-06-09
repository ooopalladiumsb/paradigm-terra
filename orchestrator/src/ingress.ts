/**
 * verifyIngress — the NORMATIVE path by which `operatorSigPresent` / `ownerSigPresent` are
 * derived from the consensus-visible signature material carried in the CAL (Exec-spec §8.3,
 * cal-co-signature-envelope.md). It lifts the Stage-6 validator principle one level up:
 *
 *     CAL → verifyIngress() → {operatorSigPresent, ownerSigPresent} → ExecutionTrace → validate()
 *
 * `validate()` (and the lifecycle/reducer) stay pure over the booleans. Lifecycle golden vectors
 * MAY inject the booleans directly — their purpose is state-machine validation, not signature
 * verification. The real ingress path uses THIS function to produce the trace.
 *
 * Two distinct channels (do NOT unify — docs/spec/tc-v2-contract-boundaries.md):
 *   operator_sig — raw Ed25519 over canonical_bytes(cal_without_signatures) (agent runtime key)
 *   owner_sig    — Contract A commit (TC v2 signData/binary) from the owner-envelope object
 *
 * D-S4 (hard): reconstruction is EXCLUSIVELY from CAL-carried fields. No backfill — a legacy
 * (hex-string) or absent owner envelope yields ownerSigPresent=false, never rescued from
 * registry / transport / Origin / node-local defaults.
 *
 * Like the validator verifier, this is an Ed25519-capable-runtime concern: TS + Go. A Rust node
 * is deferred-by-constraint (no no-build-script Ed25519), consistent with validator-rs.
 */

import { canonicalUnsignedBytes } from "@paradigm-terra/cal";
import {
  operatorSigPresent as verifyOperatorRaw,
  ownerSigPresent as verifyOwnerContractA,
  type Json,
  type OwnerCoSignature,
} from "@paradigm-terra/cal-validator";

const strip0x = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h);
const hexToB64 = (h: string): string => Buffer.from(strip0x(h), "hex").toString("base64");

/** Registry record for the CAL's agent (consensus state). */
export interface AgentKeys {
  readonly operator_pubkey?: string;
  readonly owner_pubkey?: string;
}

export interface IngressVerdict {
  readonly operatorSigPresent: boolean;
  readonly ownerSigPresent: boolean;
}

/** Derive the trace signature-presence booleans from the CAL's signatures + registry pubkeys. */
export function verifyIngress(cal: Json, agent: AgentKeys): IngressVerdict {
  const canonicalBytes = canonicalUnsignedBytes(cal);
  const sigs = ((cal as Record<string, unknown>)["signatures"] ?? {}) as Record<string, unknown>;

  // operator_sig — raw Ed25519
  const opPub = strip0x(String(agent.operator_pubkey ?? ""));
  const operatorSig = sigs["operator_sig"];
  const operatorSigPresent =
    opPub !== "" && typeof operatorSig === "string"
      ? verifyOperatorRaw(canonicalBytes, hexToB64(operatorSig), opPub)
      : false;

  // owner_sig — Contract A commit, ONLY from the envelope object (no backfill, D-S4)
  let ownerSigPresent = false;
  const ownerPub = strip0x(String(agent.owner_pubkey ?? ""));
  const ownerSig = sigs["owner_sig"];
  if (ownerPub !== "" && ownerSig !== null && typeof ownerSig === "object") {
    const ow = ownerSig as Record<string, unknown>;
    const env: OwnerCoSignature = {
      calCanonicalBytesB64: Buffer.from(canonicalBytes).toString("base64"),
      workchain: Number(ow["workchain"]),
      addressHashHex: strip0x(String(ow["address_hash"])),
      domain: String(ow["domain"]),
      timestamp: ow["timestamp"] as number | bigint,
      signatureB64: hexToB64(String(ow["signature"])),
    };
    ownerSigPresent = verifyOwnerContractA(env, ownerPub);
  }

  return { operatorSigPresent, ownerSigPresent };
}
