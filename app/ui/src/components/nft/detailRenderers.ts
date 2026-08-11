import { FC } from "react";
import { NFTItem } from "@strato/shared-types";
import GenericNFTDetail from "./GenericNFTDetail";
import V3PositionNFTDetail from "./V3PositionNFTDetail";

/**
 * Detail-renderer registry — the UI seam that keeps the NFT core protocol-agnostic.
 *
 * The detail page resolves a renderer by the item's `kind` (assigned by the backend's
 * NFT source registry). Ordinary collections render the generic metadata view;
 * "poolv3-position" (PositionManagerV3 liquidity positions) renders position economics
 * with position-appropriate actions. See design-documents/nft-backend-ui.md.
 */
export interface NFTDetailRendererProps {
  item: NFTItem;
  /** Re-fetch after a state-changing action (transfer/burn). */
  onChanged: () => void;
}

const nftDetailRenderers: Record<string, FC<NFTDetailRendererProps>> = {
  collection: GenericNFTDetail,
  "poolv3-position": V3PositionNFTDetail,
};

export const resolveNFTDetailRenderer = (kind?: string): FC<NFTDetailRendererProps> =>
  nftDetailRenderers[kind ?? "collection"] ?? GenericNFTDetail;
