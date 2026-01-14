import { useState, useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import ActivityFeedList from "../components/dashboard/ActivityFeedList";
import { Activity } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { useUser } from "@/context/UserContext";

const ActivityFeed = () => {
  const [searchParams] = useSearchParams();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { userAddress } = useUser();

  const [activeTab, setActiveTab] = useState<"activity" | "my-activity">(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "my-activity") {
      return tabParam;
    }
    return "activity";
  });

  useEffect(() => {
    document.title = "Activity Feed | STRATO";
  }, []);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "activity" || tabParam === "my-activity") {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader
          title="Activity Feed"
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <main className="p-4 sm:p-6">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Blockchain Events</h1>
            </div>
            <p className="text-sm sm:text-base text-muted-foreground">
              View all events emitted from smart contracts on the blockchain
            </p>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "activity" | "my-activity")}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="my-activity">My Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="activity">
              <ActivityFeedList />
            </TabsContent>

            <TabsContent value="my-activity">
              <ActivityFeedList myActivityOnly={true} userAddress={userAddress} />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
};

export default ActivityFeed;
