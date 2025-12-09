import { useState, useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import ActivityFeedList from "../components/dashboard/ActivityFeedList";
import { Activity } from "lucide-react";

const ActivityFeed = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    document.title = "Activity Feed | STRATO";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
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
              <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Blockchain Events</h1>
            </div>
            <p className="text-sm sm:text-base text-gray-600">
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