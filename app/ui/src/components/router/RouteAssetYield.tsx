import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { useEarnContext } from "@/context/EarnContext";
import { buildAssetApyInfo } from "@/utils/earnUtils";
import { normalizeRouteAddress } from "@/lib/route";

export default function RouteAssetYield({ address }: { address?: string }) {
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  if (!address) return null;
  if (!tokenApysLoaded) return <p className="mt-2 text-xs text-muted-foreground">Loading APY…</p>;

  // Holding yield only (same breakdown tooltip as the portfolio page). Rewards
  // APY is deliberately excluded here: route rewards are shown per hop by the
  // RewardsWidget, and pool rewards do not accrue from simply holding the asset.
  const apys = tokenApys.find(entry => normalizeRouteAddress(entry.token) === normalizeRouteAddress(address))?.apys ?? [];
  const assetApy = buildAssetApyInfo(apys);

  return <div className="mt-2 text-xs">
    {assetApy ? <EarnApyTooltip info={assetApy}>
      <span className="font-semibold text-emerald-700 dark:text-emerald-400">Est. APY · {assetApy.total.toFixed(2)}%</span>
    </EarnApyTooltip> : <p className="text-muted-foreground">Est. APY · —</p>}
  </div>;
}
