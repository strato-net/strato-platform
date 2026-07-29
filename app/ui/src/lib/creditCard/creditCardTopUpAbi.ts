/**
 * ABI for CreditCardTopUp contract (getCards, addCard, updateCard, removeCard).
 * CardInfo is returned as tuple (nickname, providerId, destinationChainId, externalToken, cardWalletAddress).
 */
export const CREDIT_CARD_TOP_UP_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getCards",
    outputs: [
      {
        components: [
          { name: "nickname", type: "string" },
          { name: "providerId", type: "string" },
          { name: "destinationChainId", type: "uint256" },
          { name: "externalToken", type: "address" },
          { name: "cardWalletAddress", type: "address" },
        ],
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "nickname", type: "string" },
      { name: "providerId", type: "string" },
      { name: "destinationChainId", type: "uint256" },
      { name: "externalToken", type: "address" },
      { name: "cardWalletAddress", type: "address" },
    ],
    name: "addCard",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "index", type: "uint256" },
      { name: "nickname", type: "string" },
      { name: "providerId", type: "string" },
      { name: "destinationChainId", type: "uint256" },
      { name: "externalToken", type: "address" },
      { name: "cardWalletAddress", type: "address" },
    ],
    name: "updateCard",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "index", type: "uint256" }],
    name: "removeCard",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export type CardInfoOnChain = readonly [
  string, // nickname
  string, // providerId
  bigint, // destinationChainId
  `0x${string}`, // externalToken
  `0x${string}`, // cardWalletAddress
];
