import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import ActivityFeedList from "../components/dashboard/ActivityFeedList";
import ActivityFeedCards from "../components/dashboard/ActivityFeedCards";
import { Activity, LogIn } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const ActivityFeed = () => {
  const { isLoggedIn } = useUser();
  const [activeTab, setActiveTab] = useState(() => isLoggedIn ? "my-activity" : "all-activity");

  useEffect(() => {
    document.title = "Activity Feed | STRATO";
  }, []);

  const handleLogin = () => {
    const theme = localStorage.getItem('theme') || 'light';
    window.location.href = `/login?theme=${theme}`;
  };

  const GuestLoginPrompt = () => (
    <Card className="border-dashed">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl">View Your Activity</CardTitle>
        <CardDescription className="text-base">
          Sign in to see your personal activity and filter events.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center space-y-4">
        <Button onClick={handleLogin} className="gap-2" size="lg">
          <LogIn className="w-4 h-4" />
          Sign In to Continue
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0 overflow-x-hidden">
      <DashboardSidebar />

      <div className="transition-all duration-300 overflow-x-hidden" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Activity Feed" />

        <main className="p-4 md:p-6 overflow-x-hidden">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to view detailed activity feed and filter events" />
          )}
          <div className="mb-6 md:mb-8">
            <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
              <Activity className="h-5 w-5 md:h-6 md:w-6 text-blue-600 dark:text-blue-400" />
              <h1 className="text-xl md:text-2xl font-bold text-foreground">Activity Feed</h1>
            </div>
            <p className="text-sm md:text-base text-muted-foreground">
              View activity and events from the blockchain
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6 p-0">
              <TabsTrigger value="my-activity" className="text-[11px] sm:text-sm px-1 sm:px-3 min-w-0 truncate">
                My Activity
              </TabsTrigger>
              <TabsTrigger value="all-activity" className="text-[11px] sm:text-sm px-1 sm:px-3 min-w-0 truncate">
                All Activity
              </TabsTrigger>
              <TabsTrigger value="blockchain-events" className="text-[11px] sm:text-sm px-1 sm:px-3 min-w-0 truncate">
                Blockchain Events
              </TabsTrigger>
            </TabsList>

            <TabsContent value="my-activity" className="mt-0">
              {isLoggedIn ? <ActivityFeedCards isMyActivity={true} /> : <GuestLoginPrompt />}
            </TabsContent>

            <TabsContent value="all-activity" className="mt-0">
              <ActivityFeedCards isMyActivity={false} />
            </TabsContent>

            <TabsContent value="blockchain-events" className="mt-0">
              <div className="mb-6 md:mb-8">
                <p className="text-sm md:text-base text-muted-foreground">
                  View all events emitted from smart contracts on the blockchain
                </p>
              </div>
              <ActivityFeedList />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default ActivityFeed;
