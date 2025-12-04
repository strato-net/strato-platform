import { useState, useEffect } from "react";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RewardsOverview } from "@/components/rewards/RewardsOverview";
import { ActivitiesTable } from "@/components/rewards/ActivitiesTable";
import { UserRewardsSection } from "@/components/rewards/UserRewardsSection";
import { LeaderboardTable } from "@/components/rewards/LeaderboardTable";
import { useRewards } from "@/hooks/useRewards";
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { useRewardsLeaderboard } from "@/hooks/useRewardsLeaderboard";

const Rewards = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"activities" | "my-rewards" | "leaderboard">("my-rewards");

  const { state, loading: stateLoading, refetch: refetchState } = useRewards();
  const { activities, loading: activitiesLoading, refetch: refetchActivities } = useRewardsActivities();
  const { userRewards, loading: userRewardsLoading, refetch: refetchUserRewards } = useRewardsUserInfo();
  const [leaderboardSortBy, setLeaderboardSortBy] = useState<"rewards" | "emissionRate">("rewards");
  const [leaderboardLimit] = useState(10);
  const [leaderboardPage, setLeaderboardPage] = useState(1);
  const leaderboardOffset = (leaderboardPage - 1) * leaderboardLimit;
  const { entries: leaderboardEntries, total: leaderboardTotal, loading: leaderboardLoading, refetch: refetchLeaderboard } = useRewardsLeaderboard(leaderboardLimit, leaderboardOffset, leaderboardSortBy);

  useEffect(() => {
    document.title = "Rewards";
  }, []);

  // Reset page to 1 when sortBy changes
  useEffect(() => {
    setLeaderboardPage(1);
  }, [leaderboardSortBy]);

  const handleClaimSuccess = () => {
    // Refetch all data after successful claim
    refetchState();
    refetchActivities();
    refetchUserRewards();
    refetchLeaderboard();
  };

  const handleRefresh = async () => {
    // Refetch all data when refresh button is clicked
    await Promise.all([
      refetchState(),
      refetchActivities(),
      refetchUserRewards(),
      refetchLeaderboard(),
    ]);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Rewards" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          {/* Global Overview */}
          <div className="mb-6">
            <RewardsOverview state={state} loading={stateLoading} onRefresh={handleRefresh} />
          </div>

          {/* Tabs for Activities, My Rewards, and Leaderboard */}
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "activities" | "my-rewards" | "leaderboard")}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3 mb-6">
               <TabsTrigger value="my-rewards">My Rewards</TabsTrigger>
              <TabsTrigger value="activities">Activities</TabsTrigger>
              <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            </TabsList>

            <TabsContent value="my-rewards">
              <UserRewardsSection
                userRewards={userRewards}
                loading={userRewardsLoading}
                onClaimSuccess={handleClaimSuccess}
              />
            </TabsContent>

            <TabsContent value="leaderboard">
              <LeaderboardTable 
                entries={leaderboardEntries}
                total={leaderboardTotal}
                limit={leaderboardLimit}
                currentPage={leaderboardPage}
                loading={leaderboardLoading}
                onSortChange={(sortBy) => {
                  setLeaderboardSortBy(sortBy);
                  setLeaderboardPage(1);
                }}
                onPageChange={setLeaderboardPage}
              />
            </TabsContent>
            <TabsContent value="activities">
              <ActivitiesTable
                activities={activities}
                loading={activitiesLoading}
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
};

export default Rewards;

