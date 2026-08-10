import { FC } from "react";
import { NFTItem } from "@strato/shared-types";
import GenericNFTDetail from "./GenericNFTDetail";

/**
 * Detail-renderer registry — the UI seam that keeps the NFT core protocol-agnostic.
 *
 * The detail page resolves a renderer by the item's `kind` (assigned by the backend's
 * NFT source registry). Ordinary collections render the generic metadata view; Phase 4
 * registers "poolv3-position" → V3PositionNFTDetail here (a Uniswap-style position page
 * composed from the existing poolv3 components) without touching anything else.
 * See design-documents/nft-backend-ui.md.
 */
export interface NFTDetailRendererProps {
  item: NFTItem;
  /** Re-fetch after a state-changing action (transfer/burn). */
  onChanged: () => void;
}

const nftDetailRenderers: Record<string, FC<NFTDetailRendererProps>> = {
  collection: GenericNFTDetail,
  // Phase 4: "poolv3-position": V3PositionNFTDetail,
};

export const resolveNFTDetailRenderer = (kind?: string): FC<NFTDetailRendererProps> =>
  nftDetailRenderers[kind ?? "collection"] ?? GenericNFTDetail;
