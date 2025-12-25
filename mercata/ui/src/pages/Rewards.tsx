import { useState, useEffect } from "react";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { RewardsOverview } from "@/components/rewards/RewardsOverview";
import { ActivitiesTable } from "@/components/rewards/ActivitiesTable";
import { UserRewardsSection } from "@/components/rewards/UserRewardsSection";
import { LeaderboardTable } from "@/components/rewards/LeaderboardTable";
import { useRewards } from "@/hooks/useRewards";
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { useTokenContext } from "@/context/TokenContext";
import { useRewardsLeaderboard } from "@/hooks/useRewardsLeaderboard";
import { useSearchParams } from "react-router-dom";
import { Gift, Activity, Trophy } from "lucide-react";

const Rewards = () => {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"activities" | "my-rewards" | "leaderboard">(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "leaderboard" || tabParam === "activities" || tabParam === "my-rewards") {
      return tabParam;
    }
    return "my-rewards";
  });

  const { state, loading: stateLoading, refetch: refetchState } = useRewards();
  const { activities, loading: activitiesLoading, refetch: refetchActivities } = useRewardsActivities();
  const { userRewards, loading: userRewardsLoading, refetch: refetchUserRewards } = useRewardsUserInfo();
  const { inactiveTokens, getInactiveTokens } = useTokenContext();
  const [leaderboardLimit] = useState(10);
  const [leaderboardPage, setLeaderboardPage] = useState(1);
  const leaderboardOffset = (leaderboardPage - 1) * leaderboardLimit;
  const { entries: leaderboardEntries, total: leaderboardTotal, loading: leaderboardLoading, refetch: refetchLeaderboard } = useRewardsLeaderboard(leaderboardLimit, leaderboardOffset);

  useEffect(() => {
    document.title = "Rewards";
    // Fetch inactive tokens (includes CATA) if not already loaded
    if (inactiveTokens.length === 0) {
      getInactiveTokens(true);
    }
  }, []);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "leaderboard" || tabParam === "activities" || tabParam === "my-rewards") {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleClaimSuccess = () => {
    // Refetch all data after successful claim
    refetchState();
    refetchActivities();
    refetchUserRewards();
    getInactiveTokens(false); // Refresh CATA balance (Total Earned)
    refetchLeaderboard();
  };

  const handleRefresh = async () => {
    // Refetch all data when refresh button is clicked
    await Promise.all([
      refetchState(),
      refetchActivities(),
      refetchUserRewards(),
      getInactiveTokens(false), // Refresh CATA balance (Total Earned)
      refetchLeaderboard(),
    ]);
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />
      <MobileBottomNav />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Rewards" />

        <main className="p-3 md:p-6">
          {/* Global Overview */}
          <div className="mb-6">
            <RewardsOverview state={state} loading={stateLoading} onRefresh={handleRefresh} />
          </div>

          {/* Underline Tabs */}
          <div className="flex md:grid md:grid-cols-3 border-b border-border mb-4 md:mb-6">
            <button
              onClick={() => setActiveTab("my-rewards")}
              className={`flex items-center justify-center gap-1.5 py-2.5 px-3 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === "my-rewards"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Gift className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span>My Rewards</span>
            </button>
            <button
              onClick={() => setActiveTab("activities")}
              className={`flex items-center justify-center gap-1.5 py-2.5 px-3 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === "activities"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Activity className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span>Activities</span>
            </button>
            <button
              onClick={() => setActiveTab("leaderboard")}
              className={`flex items-center justify-center gap-1.5 py-2.5 px-3 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === "leaderboard"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Trophy className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span>Leaderboard</span>
            </button>
          </div>

          {/* Tab Contents */}
          {activeTab === "my-rewards" && (
            <UserRewardsSection
              userRewards={userRewards}
              loading={userRewardsLoading}
              onClaimSuccess={handleClaimSuccess}
            />
          )}

          {activeTab === "activities" && (
            <ActivitiesTable
              activities={activities}
              loading={activitiesLoading}
            />
          )}

          {activeTab === "leaderboard" && (
            <LeaderboardTable 
              entries={leaderboardEntries}
              total={leaderboardTotal}
              limit={leaderboardLimit}
              currentPage={leaderboardPage}
              loading={leaderboardLoading}
              onPageChange={setLeaderboardPage}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default Rewards;
