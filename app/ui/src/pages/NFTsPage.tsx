import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { useUser } from "@/context/UserContext";
import { useNFTContext } from "@/context/NFTContext";
import NFTThumbnail from "@/components/nft/NFTThumbnail";

/** All NFTs the signed-in user owns, across every registered NFT source. */
const NFTsPage = () => {
  const { isLoggedIn } = useUser();
  const { ownedNFTs, loadingOwned, getOwnedNFTs } = useNFTContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn) return;
    getOwnedNFTs().catch(() => {
      /* empty state covers fetch failure */
    });
  }, [isLoggedIn, getOwnedNFTs]);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-[padding-left] duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="NFTs" />
        <main className="p-4 md:p-6">
          {!isLoggedIn && <GuestSignInBanner message="Sign in to see the NFTs you own" />}
          <div className="max-w-6xl mx-auto">
            {loadingOwned && ownedNFTs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading NFTs…</p>
            ) : !isLoggedIn || ownedNFTs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {isLoggedIn ? "You don't own any NFTs yet." : ""}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {ownedNFTs.map((nft) => (
                  <button
                    key={`${nft.collection.address}-${nft.tokenId}`}
                    type="button"
                    onClick={() =>
                      navigate(
                        // canonical position URL carries no manager address; other kinds
                        // keep the collection-scoped NFT route
                        nft.kind === "poolv3-position"
                          ? `/dashboard/v3-liquidity/${nft.tokenId}`
                          : `/dashboard/nfts/${nft.collection.address}/${nft.tokenId}`
                      )
                    }
                    className="bg-card rounded-xl border border-border p-4 text-left hover:bg-muted/50 transition-colors flex flex-col items-center gap-3"
                  >
                    <NFTThumbnail nft={nft} className="w-24 h-24 text-lg" />
                    <div className="w-full min-w-0 text-center">
                      <p className="text-sm font-medium truncate">
                        {nft.collection.name || nft.collection.symbol} #{nft.tokenId}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{nft.collection.symbol}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default NFTsPage;
