/**
 * NFT types (ERC-721 layer). See design-documents/nft-backend-ui.md.
 *
 * `kind` discriminates which registered NFT source an item came from ("collection" for
 * ordinary NFT collections; future kinds — e.g. V3 position NFTs — pick their own detail
 * renderer in the UI). The NFT core is protocol-agnostic by design.
 */

export interface NFTCollection {
  address: string;
  name: string;
  symbol: string;
  /** Collection owner (Ownable._owner) — who may mint. */
  owner?: string;
  /** NFTStatus enum ordinal as string/number from Cirrus: 1 PENDING, 2 ACTIVE, 3 LEGACY. Absent for bare ERC721 sources. */
  status?: string | number;
  /** Pausable._paused — true when transfers/burns are frozen for non-owners (prerequisite for disabled-Transfer UX). */
  paused?: boolean;
  description?: string;
  images?: Array<{ value: string }>;
}

export interface OwnedNFT {
  kind: string;
  collection: NFTCollection;
  tokenId: string;
  tokenURI: string;
}

export interface NFTItem extends OwnedNFT {
  owner: string;
  /** Approved address for this tokenId, if any. */
  approved?: string;
}

// Collection creation and minting happen on-chain directly (not through the app), so
// there are no create/mint param types — only the owner-facing transfer/burn actions.

export interface TransferNFTParams {
  collectionAddress: string;
  to: string;
  tokenId: string;
}

export interface BurnNFTParams {
  collectionAddress: string;
  tokenId: string;
}
