import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Send, Flame, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { useNFTContext } from "@/context/NFTContext";
import { useSwapContext } from "@/context/SwapContext";
import { PoolV3, PoolV3Position } from "@/interface";
import { formatTokenAmount, formatTickAsPrice } from "@/components/poolv3/poolV3Utils";
import TransferNFTModal from "./TransferNFTModal";
import { NFTDetailRendererProps } from "./detailRenderers";

const normalize = (address?: string) => (address || "").toLowerCase().replace(/^0x/, "");

/**
 * Detail renderer for V3 liquidity-position NFTs (kind "poolv3-position"): position
 * economics from /poolv3/positions plus the NFT actions that make sense for a position —
 * transfer (moves the liquidity and accrued fees with the token) and burn (only possible
 * once the position is emptied; management itself lives on the Liquidity page).
 */
const V3PositionNFTDetail = ({ item, onChanged }: NFTDetailRendererProps) => {
  const { userAddress } = useUser();
  const { burnNFT } = useNFTContext();
  const { fetchV3Positions, getV3PoolByAddress } = useSwapContext();
  const { toast } = useToast();
  const [transferOpen, setTransferOpen] = useState(false);
  const [burnOpen, setBurnOpen] = useState(false);
  const [burning, setBurning] = useState(false);
  const [position, setPosition] = useState<PoolV3Position | null>(null);
  const [pool, setPool] = useState<PoolV3 | null>(null);
  const [positionLoading, setPositionLoading] = useState(true);

  const isOwner = normalize(userAddress) === normalize(item.owner);

  // /poolv3/positions returns the CALLER's live positions (empty ones are filtered out),
  // so a miss for the owner means the position is emptied — exactly the burnable state.
  useEffect(() => {
    let cancelled = false;
    setPositionLoading(true);
    (async () => {
      try {
        if (!isOwner) return;
        const positions = await fetchV3Positions();
        const mine = positions.find((p) => p.kind === "nft" && p.tokenId === item.tokenId);
        if (cancelled) return;
        setPosition(mine ?? null);
        if (mine) setPool(await getV3PoolByAddress(mine.poolAddress));
      } finally {
        if (!cancelled) setPositionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, item.tokenId, fetchV3Positions, getV3PoolByAddress]);

  const isEmpty = isOwner && !positionLoading && !position;

  const handleBurn = async () => {
    setBurning(true);
    try {
      await burnNFT({ collectionAddress: item.collection.address, tokenId: item.tokenId });
      toast({
        title: "Position NFT burned",
        description: `Position #${item.tokenId} was permanently destroyed.`,
      });
      onChanged();
    } catch (error) {
      const err = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
      toast({
        title: "Burn failed",
        description: err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBurning(false);
      setBurnOpen(false);
    }
  };

  const uncollected0 = position
    ? BigInt(position.tokensOwed0) + BigInt(position.pendingFees0 ?? "0")
    : 0n;
  const uncollected1 = position
    ? BigInt(position.tokensOwed1) + BigInt(position.pendingFees1 ?? "0")
    : 0n;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          {item.collection.name || "V3 Liquidity Positions"} ({item.collection.symbol || "V3-POS"})
        </p>
        <div className="flex items-center gap-2">
          <h2 className="text-xl md:text-2xl font-semibold">Position #{item.tokenId}</h2>
          {position && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${
                position.inRange ? "text-green-600 border-green-600/40" : "text-yellow-600 border-yellow-600/40"
              }`}
            >
              {position.inRange ? "In range" : "Out of range"}
            </Badge>
          )}
        </div>
      </div>

      <div className="text-sm space-y-1.5">
        <div className="flex gap-2 min-w-0">
          <span className="text-muted-foreground flex-shrink-0">Owner</span>
          <span className="font-mono truncate">{item.owner}</span>
          {isOwner && <span className="text-xs text-strato-blue flex-shrink-0">(you)</span>}
        </div>
        <div className="flex gap-2 min-w-0">
          <span className="text-muted-foreground flex-shrink-0">Manager</span>
          <span className="font-mono truncate">{item.collection.address}</span>
        </div>
      </div>

      {position && pool && (
        <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-2 text-sm max-w-lg">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Pool</span>
            <span className="font-medium">
              {pool.token0.symbol}/{pool.token1.symbol} · {pool.fee / 10000}%
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Range</span>
            <span className="font-medium text-right">
              {formatTickAsPrice(position.tickLower)} – {formatTickAsPrice(position.tickUpper)}{" "}
              {pool.token1.symbol}/{pool.token0.symbol}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Position value</span>
            <span className="font-medium text-right">
              {formatTokenAmount(position.amount0, pool.token0.decimals)} {pool.token0.symbol} +{" "}
              {formatTokenAmount(position.amount1, pool.token1.decimals)} {pool.token1.symbol}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Uncollected (incl. pending fees)</span>
            <span className="font-medium text-right">
              {formatTokenAmount(uncollected0.toString(), pool.token0.decimals)} {pool.token0.symbol} +{" "}
              {formatTokenAmount(uncollected1.toString(), pool.token1.decimals)} {pool.token1.symbol}
            </span>
          </div>
        </div>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground max-w-lg">
          This position holds no liquidity and no uncollected tokens. The NFT can be burned, or
          topped up again from the Liquidity page.
        </p>
      )}
      {!isOwner && (
        <p className="text-sm text-muted-foreground max-w-lg">
          Position economics (range, liquidity, uncollected fees) are visible to the position's
          holder on the Liquidity page.
        </p>
      )}

      {isOwner && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" asChild>
            <Link to="/dashboard/v3-liquidity">
              <ArrowUpRight className="h-3.5 w-3.5 mr-1.5" />
              Manage position
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Transfer
          </Button>
          {isEmpty && (
            <Button size="sm" variant="outline" onClick={() => setBurnOpen(true)}>
              <Flame className="h-3.5 w-3.5 mr-1.5" />
              Burn
            </Button>
          )}
        </div>
      )}

      <TransferNFTModal
        item={item}
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onTransferred={onChanged}
        warning="Transferring this NFT transfers the position itself — its liquidity and all uncollected fees move to the new holder."
      />

      <AlertDialog open={burnOpen} onOpenChange={setBurnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Burn position #{item.tokenId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Burning permanently destroys this position NFT. It only succeeds because the
              position is empty; this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={burning}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBurn} disabled={burning}>
              {burning ? "Burning…" : "Burn"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default V3PositionNFTDetail;
