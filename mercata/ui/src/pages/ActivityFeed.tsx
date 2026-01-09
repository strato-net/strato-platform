import { useState, useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import ActivityFeedList from "../components/dashboard/ActivityFeedList";
import MyActivityList from "../components/dashboard/MyActivityList";
import AllActivityList from "../components/dashboard/AllActivityList";
import { Activity } from "lucide-react";

type TabType = 'my-activity' | 'all-activity' | 'blockchain-events';

const tabs: { value: TabType; label: string }[] = [
  { value: 'my-activity', label: 'My Activity' },
  { value: 'all-activity', label: 'All Activity' },
  { value: 'blockchain-events', label: 'Blockchain Events' },
];

const ActivityFeed = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('my-activity');

  useEffect(() => {
    document.title = "Activity | STRATO";
  }, []);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0 overflow-x-hidden">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />

      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader 
          title="Activity" 
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <main className="p-3 md:p-6">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Activity</h1>
            </div>
            <p className="text-sm sm:text-base text-muted-foreground">
              Track your activities and blockchain events
            </p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border mb-6">
            {tabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`flex-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  activeTab === tab.value
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'my-activity' && <MyActivityList />}
          {activeTab === 'all-activity' && <AllActivityList />}
          {activeTab === 'blockchain-events' && <ActivityFeedList />}
        </main>
      </div>
    </div>
  );
};

export default ActivityFeed;
