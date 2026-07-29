"use strict";

const ADDRESS_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

const REVIEWED_FEE_POLICIES = Object.freeze({
  "114784819836269": Object.freeze({
    networkID: "114784819836269",
    stateAddress: "00000000000000000000000000000000dec1de02",
    feeContract: "00000000000000000000000000000000dec1de02",
    codeHash: "a2c20a58f9ac408dc1d64c94e4ff07da1caeaefb52becca49a135e1b55396f28",
    feeToken: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
    feeWei: "10000000000000000",
    review: "Helium repository/source audit",
  }),
});

function normalizeAddress(value, label) {
  const address = String(value == null ? "" : value).replace(/^0x/i, "").toLowerCase();
  if (!ADDRESS_RE.test(address)) throw new Error(`${label} is not a 40-hex address`);
  return address;
}

function normalizeCodeHash(value, label) {
  const codeHash = String(value == null ? "" : value).replace(/^0x/i, "").toLowerCase();
  if (!HASH_RE.test(codeHash)) throw new Error(`${label} is not a 64-hex code hash`);
  return codeHash;
}

function parseStoredAddress(value) {
  const match = /^address\((?:0x)?([0-9a-fA-F]{40})\)$/.exec(String(value == null ? "" : value));
  if (!match) throw new Error(`Invalid STRATO stored address: ${String(value)}`);
  return match[1].toLowerCase();
}

function reviewedPolicyForNetwork(networkID) {
  const policy = REVIEWED_FEE_POLICIES[String(networkID)];
  if (!policy) throw new Error(`No reviewed fee policy for network ${networkID}`);
  return policy;
}

function parseFeePolicyEvidence(networkID, storageRows, accountRows, requestedFeeToken) {
  const policy = reviewedPolicyForNetwork(networkID);
  if (!Array.isArray(storageRows) || storageRows.length !== 1) {
    throw new Error("Expected exactly one DeciderState currentFeeContract storage row");
  }
  const storage = storageRows[0];
  if (String(storage.key) !== "currentFeeContract") {
    throw new Error(`Unexpected DeciderState storage key: ${String(storage.key)}`);
  }
  if (normalizeAddress(storage.address, "storage address") !== policy.stateAddress) {
    throw new Error("DeciderState storage row address does not match reviewed policy");
  }
  const feeContract = parseStoredAddress(storage.value);
  if (feeContract !== policy.feeContract) {
    throw new Error(
      `Active fee contract mismatch: live=${feeContract} reviewed=${policy.feeContract}`
    );
  }

  if (!Array.isArray(accountRows) || accountRows.length !== 1) {
    throw new Error("Expected exactly one active fee-contract account row");
  }
  const account = accountRows[0];
  if (normalizeAddress(account.address, "account address") !== feeContract) {
    throw new Error("Fee-contract account response address does not match active pointer");
  }
  const codeHash = normalizeCodeHash(
    account.codeHash == null ? account.code_hash : account.codeHash,
    "fee-contract codeHash"
  );
  if (codeHash !== policy.codeHash) {
    throw new Error(`Fee-contract code hash mismatch: live=${codeHash} reviewed=${policy.codeHash}`);
  }
  const feeToken = normalizeAddress(requestedFeeToken, "requested fee token");
  if (feeToken !== policy.feeToken) {
    throw new Error(`Fee token mismatch: requested=${feeToken} reviewed=${policy.feeToken}`);
  }

  return {
    reviewedPolicy: policy,
    observed: {
      stateAddress: normalizeAddress(storage.address, "storage address"),
      storageKey: String(storage.key),
      storageValue: String(storage.value),
      feeContract,
      codeHash,
      accountAddress: normalizeAddress(account.address, "account address"),
    },
    verifiedFeeToken: policy.feeToken,
    verifiedFeeWei: policy.feeWei,
  };
}

module.exports = {
  REVIEWED_FEE_POLICIES,
  normalizeAddress,
  normalizeCodeHash,
  parseFeePolicyEvidence,
  parseStoredAddress,
  reviewedPolicyForNetwork,
};
