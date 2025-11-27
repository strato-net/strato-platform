import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Activity, RewardsUserInfo } from "@/services/rewardsService";
import { formatBalance, calculateTokenValue } from "@/utils/numberUtils";
import { formatEmissionRatePerDay, formatEmissionRatePerWeek } from "@/services/rewardsService";
import { formatDistanceToNow } from "date-fns";
import { CopyableHash } from "@/components/common/CopyableHash";
import { Separator } from "@/components/ui/separator";
import { useOracleContext } from "@/context/OracleContext";

interface ActivityDetailModalProps {
  activity: Activity | null;
  userInfo: RewardsUserInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ActivityDetailModal = ({
  activity,
  userInfo,
  open,
  onOpenChange,
}: ActivityDetailModalProps) => {
  const { getPrice } = useOracleContext();
  
  if (!activity) return null;

  const emissionPerDay = formatEmissionRatePerDay(activity.emissionRate);
  const emissionPerWeek = formatEmissionRatePerWeek(activity.emissionRate);
  const priceWei = getPrice(activity.sourceContract);
  const totalTVLUSD = priceWei 
    ? calculateTokenValue(activity.totalStake, priceWei)
    : null;
  const totalTVLFormatted = totalTVLUSD 
    ? `$${parseFloat(totalTVLUSD).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${formatBalance(activity.totalStake, "", 18, 2, 6)}`;
  const accRewardPerStakeFormatted = formatBalance(activity.accRewardPerStake, "", 18, 2, 6);
  const lastUpdate = new Date(Number(activity.lastUpdateTime) * 1000);
  const timeAgo = formatDistanceToNow(lastUpdate, { addSuffix: true });

  const userTVLUSD = userInfo && priceWei
    ? calculateTokenValue(userInfo.stake, priceWei)
    : null;
  const userTVLFormatted = userInfo
    ? (userTVLUSD 
        ? `$${parseFloat(userTVLUSD).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `$${formatBalance(userInfo.stake, "", 18, 2, 6)}`)
    : "$0";
  const userShare = userInfo && BigInt(activity.totalStake) > 0n
    ? (BigInt(userInfo.stake) * 10000n) / BigInt(activity.totalStake) / 100n
    : 0n;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{activity.name}</DialogTitle>
          <DialogDescription>
            Activity #{activity.activityId} •{" "}
            <Badge variant={activity.activityType === 0 ? "default" : "secondary"}>
              {activity.activityType === 0 ? "Position" : "One-Time"}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <div>
            <h3 className="font-semibold mb-3">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Activity ID</p>
                <p className="font-mono font-medium">{activity.activityId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Type</p>
                <p>
                  {activity.activityType === 0 ? "Position" : "One-Time"}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Emission Info */}
          <div>
            <h3 className="font-semibold mb-3">Emission Rate</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Per Day</p>
                <p className="font-medium">{emissionPerDay} points/day</p>
              </div>
              <div>
                <p className="text-muted-foreground">Per Week</p>
                <p className="font-medium">{emissionPerWeek} points/week</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* TVL Info */}
          <div>
            <h3 className="font-semibold mb-3">Total TVL</h3>
            <p className="text-2xl font-bold">{totalTVLFormatted}</p>
          </div>

          <Separator />

          {/* Index Info */}
          <div>
            <h3 className="font-semibold mb-3">Reward Index</h3>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-muted-foreground">Accumulated Reward Per Stake</p>
                <p className="font-mono">{accRewardPerStakeFormatted}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last Updated</p>
                <p>{timeAgo}</p>
                <p className="text-xs text-muted-foreground">
                  {lastUpdate.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* User Position (if connected) */}
          {userInfo && (
            <>
              <div>
                <h3 className="font-semibold mb-3">Your Position</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Your TVL</p>
                    <p className="font-medium">{userTVLFormatted}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Pool Share</p>
                    <p className="font-medium">{userShare.toString()}%</p>
                  </div>
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Contract Addresses */}
          <div>
            <h3 className="font-semibold mb-3">Contract Addresses</h3>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-muted-foreground">Source Contract</p>
                <CopyableHash hash={activity.sourceContract} />
              </div>
              <div>
                <p className="text-muted-foreground">Allowed Caller</p>
                <CopyableHash hash={activity.allowedCaller} />
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

