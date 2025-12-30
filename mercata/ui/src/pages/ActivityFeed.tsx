import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import ActivityFeedList from "../components/dashboard/ActivityFeedList";
import MyActivityList from "../components/dashboard/MyActivityList";
import AllActivityList from "../components/dashboard/AllActivityList";
import { Activity } from "lucide-react";

type ActivityTab = "my-activity" | "all-activity" | "blockchain-events";

const ActivityFeed = () => {
  const [activeTab, setActiveTab] = useState<ActivityTab>("blockchain-events");

  useEffect(() => {
    document.title = "Activity | STRATO";
  }, []);

  const tabs = [
    { id: "my-activity" as ActivityTab, label: "My Activity" },
    { id: "all-activity" as ActivityTab, label: "All Activity" },
    { id: "blockchain-events" as ActivityTab, label: "Blockchain Events" },
  ];

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0 overflow-x-hidden">
      <DashboardSidebar />
      <MobileBottomNav />

      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Activity" />

        <main className="p-3 md:p-6">
          {/* Tabs */}
          <div className="mb-6">
            <div className="flex gap-1 border-b border-border">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2.5 text-sm font-medium transition-all relative ${
                    activeTab === tab.id
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-t-full" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === "my-activity" && (
            <MyActivityList />
          )}

          {activeTab === "all-activity" && (
            <AllActivityList />
          )}

          {activeTab === "blockchain-events" && (
            <>
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
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default ActivityFeed;
