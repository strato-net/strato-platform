import { useState, useEffect } from "react";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RewardsOverview } from "@/components/rewards/RewardsOverview";
import { ActivitiesTable } from "@/components/rewards/ActivitiesTable";
import { UserRewardsSection } from "@/components/rewards/UserRewardsSection";
import { ActivityDetailModal } from "@/components/rewards/ActivityDetailModal";
import { useRewards } from "@/hooks/useRewards";
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { Activity } from "@/services/rewardsService";

const Rewards = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"activities" | "my-rewards">("activities");
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const { state, loading: stateLoading, refetch: refetchState } = useRewards();
  const { activities, loading: activitiesLoading, refetch: refetchActivities } = useRewardsActivities();
  const { userRewards, loading: userRewardsLoading, refetch: refetchUserRewards } = useRewardsUserInfo();

  useEffect(() => {
    document.title = "Rewards | STRATO Mercata";
  }, []);

  const handleActivityClick = (activity: Activity) => {
    setSelectedActivity(activity);
    setIsDetailModalOpen(true);
  };

  const handleClaimSuccess = () => {
    // Refetch all data after successful claim
    refetchState();
    refetchActivities();
    refetchUserRewards();
  };

  // Get user info for selected activity
  const selectedActivityUserInfo = selectedActivity && userRewards
    ? userRewards.activities.find((a) => a.activityId === selectedActivity.activityId)?.userInfo || null
    : null;

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
            <RewardsOverview state={state} loading={stateLoading} />
          </div>

          {/* Tabs for Activities and My Rewards */}
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "activities" | "my-rewards")}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="activities">Activities</TabsTrigger>
              <TabsTrigger value="my-rewards">My Rewards</TabsTrigger>
            </TabsList>

            <TabsContent value="activities">
              <ActivitiesTable
                activities={activities}
                loading={activitiesLoading}
                onActivityClick={handleActivityClick}
              />
            </TabsContent>

            <TabsContent value="my-rewards">
              <UserRewardsSection
                userRewards={userRewards}
                loading={userRewardsLoading}
                onClaimSuccess={handleClaimSuccess}
              />
            </TabsContent>
          </Tabs>

          {/* Activity Detail Modal */}
          <ActivityDetailModal
            activity={selectedActivity}
            userInfo={selectedActivityUserInfo}
            open={isDetailModalOpen}
            onOpenChange={setIsDetailModalOpen}
          />
        </main>
      </div>
    </div>
  );
};

export default Rewards;

