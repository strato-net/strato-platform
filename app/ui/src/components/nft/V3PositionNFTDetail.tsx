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
import { formatTokenAmount, formatTickAsPrice, formatPriceWad } from "@/components/poolv3/poolV3Utils";
import { formatCurrency } from "@/utils/numberUtils";
import TokenPairIcons from "@/components/poolv3/TokenPairIcons";
import TransferNFTModal from "./TransferNFTModal";
import { NFTDetailRendererProps } from "./detailRenderers";

const normalize = (address?: string) => (address || "").toLowerCase().replace(/^0x/, "");
const shortAddress = (address?: string) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "");

/** Icon + symbol on the left, amount on the right — one asset line in a stat card. */
const TokenAmountRow = ({
  token,
  amount,
}: {
  token: PoolV3["token0"];
  amount: bigint | string;
}) => (
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-2 min-w-0">
      {token.image ? (
        <img src={token.image} alt={token.symbol} className="w-5 h-5 rounded-full object-cover border border-border bg-card" />
      ) : (
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] text-white font-medium bg-strato-blue border border-border">
          {token.symbol?.slice(0, 1)}
        </div>
      )}
      <span className="text-sm">{token.symbol}</span>
    </div>
    <span className="text-sm font-medium">{formatTokenAmount(amount, token.decimals)}</span>
  </div>
);

/**
 * Detail renderer for V3 liquidity-position NFTs (kind "poolv3-position"), styled after
 * Uniswap's position page: the pool pair is the headline (fee tier + range status),
 * with position value, uncollected fees and the price range as stat cards. NFT actions
 * that make sense for a position — transfer (moves the liquidity and accrued fees with
 * the token) and burn (only possible once the position is emptied) — live below;
 * management itself is on the Liquidity page.
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
  const [positionLoadFailed, setPositionLoadFailed] = useState(false);

  const isOwner = normalize(userAddress) === normalize(item.owner);

  // /poolv3/positions returns the CALLER's live positions (empty ones are filtered out),
  // so a miss for the owner means the position is emptied — exactly the burnable state.
  // A FAILED fetch means nothing of the sort: it must not present a funded position as
  // burnable, so failures land in their own state instead of "no position".
  useEffect(() => {
    let cancelled = false;
    setPositionLoading(true);
    setPositionLoadFailed(false);
    (async () => {
      try {
        if (!isOwner) return;
        const positions = await fetchV3Positions();
        const mine = positions.find((p) => p.kind === "nft" && p.tokenId === item.tokenId);
        if (cancelled) return;
        setPosition(mine ?? null);
        if (mine) setPool(await getV3PoolByAddress(mine.poolAddress));
      } catch (err) {
        console.error(err);
        if (!cancelled) setPositionLoadFailed(true);
      } finally {
        if (!cancelled) setPositionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, item.tokenId, fetchV3Positions, getV3PoolByAddress]);

  const isEmpty = isOwner && !positionLoading && !positionLoadFailed && !position;

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
    <div className="space-y-5 max-w-2xl">
      {/* Headline: the pool pair, not the token id — the id only matters in dialogs */}
      <div>
        {position && pool ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <TokenPairIcons token0={pool.token0} token1={pool.token1} size="lg" />
            <h2 className="text-xl md:text-2xl font-semibold">
              {pool.token0.symbol} / {pool.token1.symbol}
            </h2>
            <Badge variant="outline" className="text-[11px] px-1.5 py-0">
              {pool.fee / 10000}%
            </Badge>
            <Badge
              variant="outline"
              className={`text-[11px] px-1.5 py-0 ${
                position.inRange ? "text-success border-success/40" : "text-warning border-warning/40"
              }`}
            >
              {position.inRange ? "In range" : "Out of range"}
            </Badge>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl md:text-2xl font-semibold">
              {item.collection.name || "V3 Liquidity Position"}
            </h2>
            {isEmpty && (
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 text-muted-foreground">
                Closed
              </Badge>
            )}
          </div>
        )}
        <p className="text-sm text-muted-foreground mt-1">
          V3 liquidity position · owned by {isOwner ? "you" : shortAddress(item.owner)}
        </p>
      </div>

      {position && pool && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Position value</p>
              {(position.valueUsd ?? 0) > 0 && (
                <p className="text-sm font-semibold">≈ ${formatCurrency(position.valueUsd!)}</p>
              )}
            </div>
            <TokenAmountRow token={pool.token0} amount={position.amount0} />
            <TokenAmountRow token={pool.token1} amount={position.amount1} />
          </div>
          <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-2.5">
            <p className="text-xs text-muted-foreground">Uncollected fees</p>
            <TokenAmountRow token={pool.token0} amount={uncollected0} />
            <TokenAmountRow token={pool.token1} amount={uncollected1} />
          </div>
          <div className="bg-muted/50 rounded-lg border border-border p-4 sm:col-span-2">
            <p className="text-xs text-muted-foreground mb-2.5">
              Price range ({pool.token1.symbol} per {pool.token0.symbol})
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-card rounded-md border border-border py-2.5 px-2">
                <p className="text-[11px] text-muted-foreground">Min</p>
                <p className="text-sm font-medium truncate">{formatTickAsPrice(position.tickLower)}</p>
              </div>
              <div className="bg-card rounded-md border border-border py-2.5 px-2">
                <p className="text-[11px] text-muted-foreground">Max</p>
                <p className="text-sm font-medium truncate">{formatTickAsPrice(position.tickUpper)}</p>
              </div>
              <div className="bg-card rounded-md border border-border py-2.5 px-2">
                <p className="text-[11px] text-muted-foreground">Current</p>
                <p className="text-sm font-medium truncate">{formatPriceWad(pool.priceWad)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {isOwner && positionLoadFailed && (
        <p className="text-sm text-destructive max-w-lg">
          Couldn't load this position's economics — reload the page to try again.
        </p>
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
            {/* deep link focuses this position's card on the Liquidity page */}
            <Link to={`/dashboard/v3-liquidity?tab=positions&position=${encodeURIComponent(`nft:${item.tokenId}`)}`}>
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
