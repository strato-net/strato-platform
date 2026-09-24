import { Link } from "react-router-dom";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { useEarnContext } from "@/context/EarnContext";
import { normalizeRouteAddress } from "@/lib/route";
import { buildAssetApyInfo } from "@/utils/earnUtils";
import type { RouteDestination } from "@strato/shared-types";

export default function RouteAssetYield({ address, destination = "token" }: { address?: string; destination?: RouteDestination }) {
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  if (!address) return null;
  if (!tokenApysLoaded) return <p className="mt-2 text-xs text-muted-foreground">Loading APY & rewards…</p>;

  const apys = tokenApys.find(entry => normalizeRouteAddress(entry.token) === normalizeRouteAddress(address))?.apys ?? [];
  const assetApy = buildAssetApyInfo(apys);
  const hasRewards = apys.some(entry => entry.source === "rewards" && Number(entry.apy) > 0);
  const hasEarnOptions = apys.some(entry => Number(entry.apy) > 0);
  const apyLabel = destination === "vault" ? "Vault APY" : destination === "savings" ? "Savings APY" : "Asset APY";

  return <div className="mt-2 space-y-1 text-xs">
    {assetApy ? <EarnApyTooltip info={assetApy}>
      <Link to="/dashboard/earn" className="font-semibold text-emerald-700 dark:text-emerald-400">{apyLabel} · {assetApy.total.toFixed(2)}% estimated ↗</Link>
    </EarnApyTooltip> : <p className="text-muted-foreground">{apyLabel} · —</p>}
    {hasEarnOptions && <p><Link to="/dashboard/earn" className="font-medium text-primary">{hasRewards ? "Rewards available · View requirements" : "Explore earning options"} ↗</Link></p>}
    {hasRewards && <p className="text-muted-foreground">{destination === "token" ? "Rewards depend on the earn activity and may require an additional deposit or stake." : "Rewards depend on this deposit’s eligibility and current program rules."}</p>}
  </div>;
}
