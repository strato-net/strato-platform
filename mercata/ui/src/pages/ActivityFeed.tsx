import { useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import ActivityFeedList from "../components/dashboard/ActivityFeedList";
import { Activity } from "lucide-react";

const ActivityFeed = () => {
  useEffect(() => {
    document.title = "Activity Feed | STRATO";
  }, []);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0 overflow-x-hidden">
      <DashboardSidebar />

      <div className="transition-all duration-300 overflow-x-hidden" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Activity Feed" />

        <main className="p-4 md:p-6 overflow-x-hidden">
          <div className="mb-6 md:mb-8">
            <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
              <Activity className="h-5 w-5 md:h-6 md:w-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-xl md:text-2xl font-bold text-foreground">Blockchain Events</h1>
            </div>
            <p className="text-sm md:text-base text-muted-foreground">
              View all events emitted from smart contracts on the blockchain
            </p>
          </div>

          <ActivityFeedList />
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default ActivityFeed;
