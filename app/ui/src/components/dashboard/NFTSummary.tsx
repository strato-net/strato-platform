import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNFTContext } from "@/context/NFTContext";
import { useUser } from "@/context/UserContext";
import NFTThumbnail from "@/components/nft/NFTThumbnail";

const MAX_ROWS = 6;

/**
 * Compact dashboard section listing the NFTs the user owns, mirroring V3LiquiditySummary.
 * Kind-agnostic by design: every registered NFT source (ordinary collections today, V3
 * position NFTs in Phase 4) surfaces here, and the detail page picks the renderer.
 * Renders nothing when the user owns no NFTs.
 */
const NFTSummary = () => {
  const { isLoggedIn } = useUser();
  const { ownedNFTs, getOwnedNFTs } = useNFTContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn) return;
    getOwnedNFTs().catch(() => {
      /* section simply stays hidden on fetch failure */
    });
  }, [isLoggedIn, getOwnedNFTs]);

  if (!isLoggedIn || ownedNFTs.length === 0) return null;

  const visible = ownedNFTs.slice(0, MAX_ROWS);

  return (
    <div className="mb-8 bg-card shadow-sm rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 md:px-6 pt-4 md:pt-5 pb-3">
        <h3 className="text-base md:text-lg font-semibold">NFTs</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate("/dashboard/nfts")}
          className="h-7 px-2.5 text-xs"
        >
          View all{ownedNFTs.length > MAX_ROWS ? ` (${ownedNFTs.length})` : ""}
          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </Button>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {visible.map((nft) => (
          <button
            key={`${nft.collection.address}-${nft.tokenId}`}
            type="button"
            onClick={() => navigate(`/dashboard/nfts/${nft.collection.address}/${nft.tokenId}`)}
            className="w-full flex items-center justify-between gap-3 px-4 md:px-6 py-3 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <NFTThumbnail nft={nft} />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">
                  {nft.collection.name || nft.collection.symbol} #{nft.tokenId}
                </span>
                <span className="text-xs text-muted-foreground truncate">{nft.collection.symbol}</span>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default NFTSummary;
