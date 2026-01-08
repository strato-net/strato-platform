import { useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import ActivityFeedList from "../components/dashboard/ActivityFeedList";
import { Activity } from "lucide-react";

const ActivityFeed = () => {
  useEffect(() => {
    document.title = "Activity | STRATO";
  }, []);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0 overflow-x-hidden">
      <DashboardSidebar />
      <MobileBottomNav />

      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Activity" />

        <main className="p-3 md:p-6">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Blockchain Events</h1>
            </div>
            <p className="text-sm sm:text-base text-muted-foreground">
              View all events emitted from smart contracts on the blockchain
            </p>
          </div>

          <ActivityFeedList />
        </main>
      </div>
    </div>
  );
};

export default ActivityFeed;
