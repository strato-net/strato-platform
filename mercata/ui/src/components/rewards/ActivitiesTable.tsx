import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Activity } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { formatEmissionRatePerDay, formatEmissionRatePerWeek, roundByMagnitude, formatRoundedWithCommas, safeBigInt } from "@/services/rewardsService";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";
import { getActivityLink } from "@/lib/rewards/activityLinks";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { useEarnContext } from "@/context/EarnContext";
import { useSaveUsdstContext } from "@/context/SaveUsdstContext";
import { buildNativeRewardsApyInfo, EarnApyInfo, findBestEarnApyInfo, findPoolEarnApyInfo } from "@/utils/earnUtils";

interface ActivitiesTableProps {
  activities: Activity[];
  loading: boolean;
}

const truncateActivityName = (name: string, maxLength: number = 30): string => {
  if (!name || name.length <= maxLength) return name;
  return name.substring(0, maxLength) + "...";
};

const getEstimatedApyPercent = (activity: Activity): number => {
  try {
    if (!activity?.emissionRate || !activity?.totalStakeUsd) return -1;

    const tvlUsd = Number(BigInt(activity.totalStakeUsd)) / 1e18;
    if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return -1;

    const annualCata = (Number(BigInt(activity.emissionRate)) / 1e18) * 86400 * 365;
    if (!Number.isFinite(annualCata) || annualCata < 0) return -1;

    return (annualCata * 0.25 / tvlUsd) * 100;
  } catch {
    return -1;
  }
};

// Mobile-friendly Info Tooltip component
const InfoTooltip = ({ content }: { content: string }) => {
  const { isMobile, showTooltip, handleToggle } = useMobileTooltip('activities-info-tooltip-container');

  if (isMobile) {
    return (
      <div className="relative activities-info-tooltip-container inline-flex">
        <Info 
          className="h-3 w-3 text-muted-foreground cursor-pointer" 
          onClick={handleToggle}
        />
        {showTooltip && (
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] bg-popover border rounded-lg px-4 py-3 text-sm text-popover-foreground shadow-lg max-w-[85vw] w-[320px]">
            <p className="text-center whitespace-pre-line">{content}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggle(e);
              }}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              <span className="sr-only">Close</span>
              ×
            </button>
          </div>
        )}
        {showTooltip && (
          <div 
            className="fixed inset-0 z-[99] bg-black/20"
            onClick={handleToggle}
          />
        )}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3 w-3 text-muted-foreground cursor-help" />
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs">{content}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export const ActivitiesTable = ({ activities, loading }: ActivitiesTableProps) => {
  const { tokenApys } = useEarnContext();
  const { saveUsdstInfo } = useSaveUsdstContext();
  const loginButtonClass = "bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90";
  const visibleActivities = activities.filter(
    (activity) => safeBigInt(activity?.emissionRate || "0") > 0n
  );
  const saveUsdstVaultAddress = saveUsdstInfo?.vaultAddress?.toLowerCase?.() || "";
  const usdstAddress = saveUsdstInfo?.assetAddress || "";

  const getBestAvailableApyInfo = (activity: Activity): EarnApyInfo | null => {
    const lowerName = activity.name?.toLowerCase?.() || "";
    const normalizedSource = activity.sourceContract?.toLowerCase?.() || "";
    const stakeAssetAddress = activity.stakeAssetAddress || null;

    if (lowerName.includes("swap lp")) {
      return findPoolEarnApyInfo(tokenApys, activity.sourceContract);
    }

    if (
      lowerName.includes("save usdst") ||
      lowerName.includes("saveusdst") ||
      (saveUsdstVaultAddress && normalizedSource === saveUsdstVaultAddress)
    ) {
      return findBestEarnApyInfo(tokenApys, saveUsdstInfo?.vaultAddress);
    }

    if (lowerName.includes("direct mint") || lowerName.includes("bridge")) {
      return findBestEarnApyInfo(tokenApys, usdstAddress);
    }

    return (
      findBestEarnApyInfo(tokenApys, stakeAssetAddress) ||
      findBestEarnApyInfo(tokenApys, activity.sourceContract) ||
      buildNativeRewardsApyInfo(null, activity.emissionRate, activity.totalStakeUsd, "rewards")
    );
  };

  const sortedActivities = [...visibleActivities]
    .map((activity) => ({
      activity,
      bestAvailableApyInfo: getBestAvailableApyInfo(activity),
    }))
    .sort((a, b) => (b.bestAvailableApyInfo?.total || 0) - (a.bestAvailableApyInfo?.total || 0));

  if (loading) {
    return (
      <Card>
        <CardHeader className="px-3 md:px-6">
          <CardTitle>Activities</CardTitle>
          <CardDescription>All reward activities</CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-6">
          <div className="space-y-2 px-3 md:px-0">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (visibleActivities.length === 0) {
    return (
      <Card>
        <CardHeader className="px-3 md:px-6">
          <CardTitle>Activities</CardTitle>
          <CardDescription>All reward activities</CardDescription>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <p className="text-muted-foreground text-center py-8">No activities found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="px-3 md:px-6">
        <CardTitle>Activities</CardTitle>
        <CardDescription>All reward activities</CardDescription>
      </CardHeader>
      <CardContent className="px-0 md:px-6">
        <div className="rounded-none md:rounded-md border-x-0 md:border-x border">
          <Table>
            <TableHeader>
              <TableRow>
                {/* <TableHead>ID</TableHead> */}
                <TableHead>S. No</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                 Best Available APY
                    <InfoTooltip content="Best Available APY shows the highest stacked yield available for this activity, combining Native APY, Base APY, and Rewards APY when applicable. Hover over the APY value to see the full breakdown." />
                  </div>
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    Emission Rate
                    <InfoTooltip content="The rate at which rewards are emitted for this activity (points per second). This is the base emission rate before factoring in your stake." />
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    Total Stake
                    <InfoTooltip content="The total amount staked across all users in this activity. Your share of rewards is proportional to your stake relative to this total.\n\nNote: Different activities may use different stake units (token units, USD-notional, or shares)." />
                  </div>
                </TableHead>
                {/* <TableHead>Last Update</TableHead> */}
                <TableHead>Earn Now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedActivities.map(({ activity, bestAvailableApyInfo }, index) => {
                const emissionRateStr = activity?.emissionRate || null;
                const emissionPerDay = emissionRateStr ? formatEmissionRatePerDay(emissionRateStr) : "?";
                const emissionPerWeek = emissionRateStr ? formatEmissionRatePerWeek(emissionRateStr) : "?";
                
                // Format total stake with denomination context
                const totalStakeStr = activity?.totalStake || null;
                const totalStakeDecimal = totalStakeStr ? formatBalance(totalStakeStr, "", 18, 18, 18) : null;
                const totalStakeRounded = totalStakeDecimal ? formatRoundedWithCommas(roundByMagnitude(totalStakeDecimal)) : "?";
                
                // Prefer backend-provided USD TVL when available (works for LP/share tokens too)
                // Otherwise, format USD-notional activities as USD
                let totalStakeFormatted = totalStakeRounded;
                if (activity?.totalStakeUsd && activity.totalStakeUsd !== "0") {
                  const tvlRounded = formatRoundedWithCommas(roundByMagnitude(formatBalance(activity.totalStakeUsd, "", 18, 18, 18)));
                  totalStakeFormatted = `$${tvlRounded}`;
                } else if (activity?.stakeDenomination === "usd_notional" && totalStakeRounded !== "?") {
                  totalStakeFormatted = `$${totalStakeRounded}`;
                }
                
                // const lastUpdateTimeStr = activity?.lastUpdateTime || null;
                // const lastUpdate = lastUpdateTimeStr ? new Date(Number(lastUpdateTimeStr) * 1000) : null;
                // const timeAgo = lastUpdate ? formatDistanceToNow(lastUpdate, { addSuffix: true }) : "?";
                const activityLink = activity?.name ? getActivityLink(activity.name) : null;

                return (
                  <TableRow
                    key={activity?.activityId || Math.random()}
                  >
                    {/* <TableCell className="font-mono font-medium">
                      {activity?.activityId !== undefined && activity?.activityId !== null ? activity.activityId : "?"}
                    </TableCell> */}
                    <TableCell className="font-mono font-medium">
                      {index + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {activity?.name ? (
                        activityLink ? (
                          <Link
                            to={activityLink}
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            {truncateActivityName(activity.name)}
                          </Link>
                        ) : (
                          truncateActivityName(activity.name)
                        )
                      ) : "?"}
                    </TableCell>
                    <TableCell>
                      {!bestAvailableApyInfo ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <EarnApyTooltip info={bestAvailableApyInfo}>
                          <span className="font-medium cursor-default">
                            {bestAvailableApyInfo.total.toFixed(2)}%
                          </span>
                        </EarnApyTooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {activity?.activityType !== undefined && activity?.activityType !== null
                          ? (activity.activityType === 1 ? "One-Time" : "Position")
                          : "?"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {emissionPerDay} {emissionPerDay !== "?" && "points/day"}
                        </div>
                        {emissionPerWeek !== "?" && (
                          <div className="text-xs text-muted-foreground">{emissionPerWeek} points/week</div>
                        )}
                        {(() => {
                          const totalStakeUsd = activity?.totalStakeUsd ? BigInt(activity.totalStakeUsd) : null;
                          if (!emissionRateStr || emissionPerDay === "?" || !totalStakeUsd || totalStakeUsd === 0n) return null;
                          const ptsPerDollarPerDayWei = (BigInt(emissionRateStr) * 86400n * (10n ** 18n)) / totalStakeUsd;
                          const formatted = formatRoundedWithCommas(roundByMagnitude(formatBalance(ptsPerDollarPerDayWei.toString(), "", 18, 18, 18)));
                          return (
                            <div className="text-xs text-muted-foreground mt-1">
                              {formatted} pts/$1/day
                            </div>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>{totalStakeFormatted}</TableCell>
                    {/* <TableCell className="text-sm text-muted-foreground">{timeAgo}</TableCell> */}
                    <TableCell>
                      {activityLink ? (
                        <Link to={activityLink}>
                          <Button size="sm" className={loginButtonClass}>Earn Now</Button>
                        </Link>
                      ) : (
                        <Button size="sm" className={loginButtonClass} disabled>Earn Now</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

