// TC v2 owner-signature verification — channel dispatcher.
//
// There is intentionally NO universal verifyTonConnectSignature(): the caller must
// resolve the contract, and each contract has its own self-contained routine. This
// mirrors the validator-integration rule (Stage 6): verifyOwnerSignatureSignData()
// and verifyOwnerSignatureTonProof() are distinct entry points, never merged.

import { verifySignData } from './sign-data.mjs';
import { verifyTonProof } from './ton-proof.mjs';

export const CONTRACTS = {
  TC_V2_SIGNDATA_VERIFY_V1: 'signData',
  TC_V2_TONPROOF_VERIFY_V1: 'tonProof',
};

/**
 * Verify under an EXPLICITLY named contract. `contract` selects the routine — passing
 * a signData capture under TC_V2_TONPROOF_VERIFY_V1 (or vice-versa) is exactly the
 * cross-channel misuse the package's cross-channel vectors assert MUST fail.
 */
export function verifyUnderContract(contract, input, signatureB64, operatorPubkeyHex) {
  switch (contract) {
    case 'TC_V2_SIGNDATA_VERIFY_V1':
      return verifySignData(input, signatureB64, operatorPubkeyHex);
    case 'TC_V2_TONPROOF_VERIFY_V1':
      return verifyTonProof(input, signatureB64, operatorPubkeyHex);
    default:
      throw new Error(`unknown contract ${JSON.stringify(contract)}`);
  }
}

export { verifySignData, verifyTonProof };
