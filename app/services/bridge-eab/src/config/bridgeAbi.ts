export const BRIDGE_DIGEST_ABI = [
  "function getDepositSettlementDigest(uint256,address,uint256,address,address,uint256,string,address,address,uint256,address,uint256) view returns (bytes32)",
  "function getReviewedDepositDigest(uint256,address,uint256) view returns (bytes32)",
  "function getWithdrawalRefundDigest(uint256) view returns (bytes32)",
  "function getDepositRefundDigest(uint256,address,uint256,string) view returns (bytes32)",
];

export const DEPOSIT_REFUND_TYPES = {
  DepositRefundAuthorization: [
    { name: "sourceChainId", type: "uint256" }, { name: "sourceBridge", type: "address" },
    { name: "destinationChainId", type: "uint256" }, { name: "destinationVault", type: "address" },
    { name: "depositRouter", type: "address" }, { name: "depositId", type: "uint256" },
    { name: "token", type: "address" }, { name: "recipient", type: "address" }, { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "signerSetVersion", type: "uint256" },
  ],
};
export const DEPOSIT_REFUND_ABI = [
  "function refundDeposit((uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationVault,address depositRouter,uint256 depositId,address token,address recipient,uint256 amount,uint256 deadline,uint256 signerSetVersion),bytes[])",
  "function depositRefundId(address,uint256) pure returns (bytes32)",
  "function refundedDeposits(bytes32) view returns (bool)",
  "function signerSetVersion() view returns (uint256)",
  "function attestationThreshold() view returns (uint8)",
  "function attestationSigners(address) view returns (bool)",
  "function maxAuthorizationValiditySeconds() view returns (uint256)",
  "event DepositRefunded(bytes32 indexed refundId,address indexed depositRouter,uint256 indexed depositId,address token,address recipient,uint256 amount)",
];

export const NATIVE_MINT_EVENT_ABI = [
  "event RepresentationMinted(uint256 sourceChainId,address indexed sourceBridge,uint256 indexed sourceWithdrawalId,address indexed stratoToken,address representationToken,address recipient,uint256 amount,bytes32 mintId)",
];

export const NATIVE_MINT_V2_FIELDS = [
  { name: "sourceChainId", type: "uint256" }, { name: "sourceBridge", type: "address" },
  { name: "destinationChainId", type: "uint256" }, { name: "destinationBridge", type: "address" },
  { name: "sourceWithdrawalId", type: "uint256" }, { name: "stratoToken", type: "address" },
  { name: "representationToken", type: "address" }, { name: "recipient", type: "address" },
  { name: "amount", type: "uint256" }, { name: "notBefore", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "useInstantPath", type: "bool" },
  { name: "maxFee", type: "uint256" }, { name: "requestedAt", type: "uint256" },
  { name: "feeHalfLife", type: "uint256" },
  { name: "signerSetVersion", type: "uint256" },
];

export const NATIVE_MINT_V2_TYPES = {
  NativeMintAttestationV2: NATIVE_MINT_V2_FIELDS,
};

export const NATIVE_ATTESTATION_ABI = [
  "function processedMints(bytes32) view returns (bool)",
  "function canceledMints(bytes32) view returns (bool)",
  "function refundedRedemptions(uint256) view returns (bool)",
  "function attestationSigners(address) view returns (bool)",
  "function attestationThreshold() view returns (uint8)",
  "function signerSetVersion() view returns (uint256)",
  "function maxAttestationValiditySeconds() view returns (uint256)",
  "function stratoToRepresentation(address) view returns (address)",
  "function routeActive(address) view returns (bool)",
];

export const NATIVE_REFUND_TYPES = {
  RedemptionRefund: [
    { name: "sourceChainId", type: "uint256" }, { name: "sourceBridge", type: "address" },
    { name: "destinationChainId", type: "uint256" }, { name: "destinationBridge", type: "address" },
    { name: "redemptionId", type: "uint256" }, { name: "representationToken", type: "address" },
    { name: "recipient", type: "address" }, { name: "amount", type: "uint256" }, { name: "deadline", type: "uint256" },
    { name: "signerSetVersion", type: "uint256" },
  ],
};
export const NATIVE_REFUND_ABI = [
  "function refundRedemption((uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 redemptionId,address representationToken,address recipient,uint256 amount,uint256 deadline,uint256 signerSetVersion),bytes[])",
  "function refundedRedemptions(uint256) view returns (bool)",
  "function maxAttestationValiditySeconds() view returns (uint256)",
  "function attestationThreshold() view returns (uint8)",
  "function signerSetVersion() view returns (uint256)",
  "function attestationSigners(address) view returns (bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "event RedemptionRefunded(uint256 indexed redemptionId,address indexed representationToken,address indexed recipient,uint256 amount)",
];

export const NATIVE_CANCELLATION_ABI = [
  "function cancelMint(uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId)",
  "function canceledMints(bytes32) view returns (bool)",
  "function processedMints(bytes32) view returns (bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "event NativeMintCanceled(bytes32 indexed mintId,uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId)",
];
