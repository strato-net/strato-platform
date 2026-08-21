import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { useNFTContext } from "@/context/NFTContext";
import { resolveNFTDetailRenderer } from "@/components/nft/detailRenderers";
import { NFTItem } from "@strato/shared-types";

/**
 * Canonical NFT detail route: /dashboard/nfts/:collectionAddress/:tokenId.
 * Resolves the item, fetches metadata through the backend proxy, and delegates
 * presentation to the renderer registered for the item's kind.
 */
const NFTDetailPage = () => {
  const { collectionAddress, tokenId } = useParams<{ collectionAddress: string; tokenId: string }>();
  const { getNFTItem } = useNFTContext();
  const navigate = useNavigate();

  const [item, setItem] = useState<NFTItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!collectionAddress || !tokenId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const fetched = await getNFTItem(collectionAddress, tokenId);
      setItem(fetched);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [collectionAddress, tokenId, getNFTItem]);

  useEffect(() => {
    load();
  }, [load]);

  // After a burn/transfer the viewer may no longer own (or the token may no longer exist);
  // reload, and fall back to the list on 404.
  const handleChanged = useCallback(() => {
    load();
  }, [load]);

  const Renderer = resolveNFTDetailRenderer(item?.kind);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="NFT" />
        <main className="p-4 md:p-6">
          <div className="max-w-6xl mx-auto space-y-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/dashboard/nfts")}
              className="h-8 px-2 -ml-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              All NFTs
            </Button>

            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading NFT…</p>
            ) : notFound || !item ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                This NFT doesn't exist (it may have been burned).
              </p>
            ) : (
              <Renderer item={item} onChanged={handleChanged} />
            )}
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default NFTDetailPage;
