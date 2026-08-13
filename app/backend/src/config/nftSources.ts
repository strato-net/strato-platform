import { constants } from "./constants";

/**
 * Registry of Cirrus sources that count as "NFTs" in the app.
 *
 * STRATO indexes each concrete contract into its own Cirrus tables, so "all NFTs a user
 * owns" is an aggregation over this list, not a single table query. The NFT core stays
 * protocol-agnostic: adding a new kind of NFT (e.g. the future V3 position manager) is
 * one entry here plus a detail renderer in the UI — see design-documents/nft-backend-ui.md.
 */
export interface NFTSource {
  /** Discriminator surfaced to the UI to pick a detail renderer (e.g. "collection"). */
  kind: string;
  /** Cirrus table prefix for the concrete contract, e.g. "BlockApps-NFT". */
  cirrusPrefix: string;
  /** Select fields for the collection-level table. Keep minimal for bare ERC721 contracts. */
  collectionSelect: string[];
  /** Whether the contract has an ERC721URIStorage `_tokenURIs` child table. */
  hasTokenURIs: boolean;
}

export const NFT_SOURCES: NFTSource[] = [
  {
    kind: "collection",
    cirrusPrefix: constants.NFT,
    collectionSelect: [
      "address",
      "_name",
      "_symbol",
      "_owner",
      "status",
      "_paused",
      "description",
      `images:${constants.NFT}-images(value)`,
    ],
    hasTokenURIs: true,
  },
  // Phase 4 (V3 position NFTs) adds:
  // { kind: "poolv3-position", cirrusPrefix: constants.PositionManagerV3,
  //   collectionSelect: ["address", "_name", "_symbol"], hasTokenURIs: false },
];
