import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { useNFTContext } from "@/context/NFTContext";
import V3PositionNFTDetail from "@/components/nft/V3PositionNFTDetail";
import { NFTItem } from "@strato/shared-types";

/**
 * Canonical V3 position route: /dashboard/v3-liquidity/:tokenId — no manager address in
 * the URL; the backend resolves the network's singleton PositionManagerV3. Renders the
 * same position detail as the NFT route, framed as liquidity rather than as an NFT.
 */
const V3PositionPage = () => {
  const { tokenId } = useParams<{ tokenId: string }>();
  const { getPositionNFTItem } = useNFTContext();
  const navigate = useNavigate();

  const [item, setItem] = useState<NFTItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tokenId) return;
    setLoading(true);
    setNotFound(false);
    try {
      setItem(await getPositionNFTItem(tokenId));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [tokenId, getPositionNFTItem]);

  useEffect(() => {
    load();
  }, [load]);

  // After a transfer/burn the token may be gone or owned by someone else; reload, and
  // the not-found state covers a burn.
  const handleChanged = useCallback(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Position" />
        <main className="p-4 md:p-6">
          <div className="max-w-6xl mx-auto space-y-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/dashboard/v3-liquidity?tab=positions")}
              className="h-8 px-2 -ml-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Liquidity
            </Button>

            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading position…</p>
            ) : notFound || !item ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                This position doesn't exist (it may have been burned).
              </p>
            ) : (
              <V3PositionNFTDetail item={item} onChanged={handleChanged} />
            )}
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default V3PositionPage;
