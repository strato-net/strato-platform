import { useState, useEffect } from "react";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useUser } from "@/context/UserContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogIn, Gift } from "lucide-react";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";

const Rewards = () => {
  const [searchParams] = useSearchParams();
  const { isLoggedIn } = useUser();
  

  const [activeTab, setActiveTab] = useState<"activities" | "my-rewards" | "leaderboard">("activities");

  const { state, loading: stateLoading, refetch: refetchState } = useRewards();
  const { activities, loading: activitiesLoading, refetch: refetchActivities } = useRewardsActivities();
  // Only fetch user rewards if logged in
  const { userRewards, loading: userRewardsLoading, refetch: refetchUserRewards } = useRewardsUserInfo();
  const { inactiveTokens, getInactiveTokens } = useTokenContext();
  const [leaderboardLimit] = useState(10);
  const [leaderboardPage, setLeaderboardPage] = useState(1);
  const leaderboardOffset = (leaderboardPage - 1) * leaderboardLimit;
  const { entries: leaderboardEntries, total: leaderboardTotal, loading: leaderboardLoading, refetch: refetchLeaderboard } = useRewardsLeaderboard(leaderboardLimit, leaderboardOffset);

  useEffect(() => {
    document.title = "Rewards | STRATO";
    // Only fetch inactive tokens if logged in
    if (isLoggedIn && inactiveTokens.length === 0) {
      getInactiveTokens(true);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "leaderboard" || tabParam === "activities" || tabParam === "my-rewards") {
      // If guest tries to access my-rewards, stay on leaderboard
      if (tabParam === "my-rewards" && !isLoggedIn) {
        setActiveTab("leaderboard");
      } else {
      setActiveTab(tabParam);
      }
    }
  }, [searchParams, isLoggedIn]);

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
    const promises = [
      refetchState(),
      refetchActivities(),
      refetchLeaderboard(),
    ];
    
    // Only refetch user-specific data if logged in
    if (isLoggedIn) {
      promises.push(refetchUserRewards());
      promises.push(getInactiveTokens(false));
    }
    
    await Promise.all(promises);
  };

  const handleLogin = () => {
    const theme = localStorage.getItem('theme') || 'light';
    window.location.href = `/login?theme=${theme}`;
  };

  // Guest login prompt component
  const GuestLoginPrompt = () => (
    <Card className="border-dashed">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 rounded-full flex items-center justify-center mb-4">
          <Gift className="w-8 h-8 text-purple-600 dark:text-purple-400" />
        </div>
        <CardTitle className="text-xl">Start Earning Rewards</CardTitle>
        <CardDescription className="text-base">
          Sign in to start earning CATA tokens and track your rewards.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center space-y-4">
        <Button 
          onClick={handleLogin}
          className="gap-2"
          size="lg"
        >
          <LogIn className="w-4 h-4" />
          Sign In to Get Started
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Rewards" />

        <main className="p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to start earning CATA tokens and track your rewards" />
          )}
          {/* Global Overview - visible to all */}
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
            <TabsTrigger value="activities">Activities</TabsTrigger>
               <TabsTrigger value="my-rewards">My Rewards</TabsTrigger>
              <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            </TabsList>

            <TabsContent value="my-rewards">
              {isLoggedIn ? (
              <UserRewardsSection
                userRewards={userRewards}
                loading={userRewardsLoading}
                onClaimSuccess={handleClaimSuccess}
              />
              ) : (
                <GuestLoginPrompt />
              )}
            </TabsContent>

            <TabsContent value="leaderboard">
              <LeaderboardTable 
                entries={leaderboardEntries}
                total={leaderboardTotal}
                limit={leaderboardLimit}
                currentPage={leaderboardPage}
                loading={leaderboardLoading}
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

      <MobileBottomNav />
    </div>
  );
};

export default Rewards;
