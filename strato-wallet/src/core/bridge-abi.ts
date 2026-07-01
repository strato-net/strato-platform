// EVM-side ABIs + constants for bridging (mirrors mercata/ui/src/lib/bridge).

import type { Hex } from "viem";

export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Hex;

export const PERMIT2_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

export const ERC20_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const REPRESENTATION_BRIDGE_ABI = [
  {
    inputs: [
      { name: "representationToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "stratoRecipient", type: "address" },
    ],
    name: "requestRedemption",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const DEPOSIT_ROUTER_ABI = [
  {
    inputs: [
      { name: "stratoAddress", type: "address" },
      { name: "targetStratoToken", type: "address" },
    ],
    name: "depositETH",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "stratoAddress", type: "address" },
      { name: "targetStratoToken", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
