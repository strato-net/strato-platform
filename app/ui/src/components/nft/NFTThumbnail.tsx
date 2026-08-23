import { OwnedNFT } from "@strato/shared-types";

/**
 * Thumbnail for an NFT row/card. The dashboard deliberately does not fetch per-item
 * metadata (N requests); it uses the collection image with a symbol-initial fallback.
 * Detail views pass `imageUrl` from resolved metadata when available.
 */
const NFTThumbnail = ({
  nft,
  imageUrl,
  className = "w-10 h-10",
}: {
  nft: OwnedNFT;
  imageUrl?: string;
  className?: string;
}) => {
  const src = imageUrl || nft.collection.images?.[0]?.value;
  if (src) {
    return (
      <img
        src={src}
        alt={`${nft.collection.symbol} #${nft.tokenId}`}
        className={`${className} rounded-lg object-cover border border-border bg-card flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${className} rounded-lg flex items-center justify-center text-xs text-white font-medium bg-strato-blue border border-border flex-shrink-0`}
    >
      {nft.collection.symbol?.slice(0, 2) || "NFT"}
    </div>
  );
};

export default NFTThumbnail;
