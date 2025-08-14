import { useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { 
  Wallet, 
  ArrowRightLeft, 
  Link2, 
  Database, 
  Book, 
  Send, 
  Activity,
  CreditCard,
  TrendingUp,
  Shield
} from "lucide-react";
import SwapWidget from "@/components/swap/SwapWidget";
import BridgeWidget from "@/components/bridge/BridgeWidget";
import { DepositForm } from "@/components/dashboard/DepositModal";
import DashboardFAQ from "@/components/dashboard/DashboardFAQ";

const Home = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const quickActions = [
    {
      title: "Deposits",
      description: "View and manage your deposited assets",
      icon: <Wallet className="h-5 w-5" />,
      path: "/dashboard/deposits",
      color: "bg-blue-500"
    },
    {
      title: "Transfer",
      description: "Send assets to other addresses",
      icon: <Send className="h-5 w-5" />,
      path: "/dashboard/transfer",
      color: "bg-green-500"
    },
    {
      title: "Borrow",
      description: "Borrow against your collateral",
      icon: <Book className="h-5 w-5" />,
      path: "/dashboard/borrow",
      color: "bg-purple-500"
    },
    {
      title: "Pools",
      description: "Provide liquidity and earn rewards",
      icon: <Database className="h-5 w-5" />,
      path: "/dashboard/pools",
      color: "bg-indigo-500"
    },
    {
      title: "Activity Feed",
      description: "Track all your transactions",
      icon: <Activity className="h-5 w-5" />,
      path: "/dashboard/activity",
      color: "bg-orange-500"
    },
    {
      title: "Overview",
      description: "View your portfolio summary",
      icon: <TrendingUp className="h-5 w-5" />,
      path: "/dashboard",
      color: "bg-teal-500"
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader 
          title="Home" 
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />
        
        <main className="p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Welcome Section */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-8 text-white">
              <h1 className="text-3xl font-bold mb-2">Welcome to STRATO Mercata</h1>
              <p className="text-lg opacity-90">Your gateway to decentralized finance. Buy, swap, bridge, and manage your digital assets all in one place.</p>
            </div>

            {/* Quick Actions Grid */}
            <div>
              <h2 className="text-2xl font-semibold mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {quickActions.map((action, index) => (
                  <Card 
                    key={index} 
                    className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => navigate(action.path)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className={`${action.color} p-3 rounded-lg text-white`}>
                          {action.icon}
                        </div>
                      </div>
                      <CardTitle className="mt-3">{action.title}</CardTitle>
                      <CardDescription>{action.description}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>

            {/* Trading Section with Tabs */}
            <div>
              <h2 className="text-2xl font-semibold mb-4">Quick Trading</h2>
              <Card>
                <CardContent className="p-6">
                  <Tabs defaultValue="buy" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="buy">
                        <CreditCard className="h-4 w-4 mr-2" />
                        Buy
                      </TabsTrigger>
                      <TabsTrigger value="swap">
                        <ArrowRightLeft className="h-4 w-4 mr-2" />
                        Swap
                      </TabsTrigger>
                      <TabsTrigger value="bridge">
                        <Link2 className="h-4 w-4 mr-2" />
                        Bridge
                      </TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="buy" className="mt-6">
                      <div className="space-y-4">
                        <div className="text-center mb-4">
                          <h3 className="text-lg font-semibold">Buy Digital Assets</h3>
                          <p className="text-sm text-muted-foreground">Purchase tokens directly with fiat currency</p>
                        </div>
                        <DepositForm />
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="swap" className="mt-6">
                      <div className="space-y-4">
                        <div className="text-center mb-4">
                          <h3 className="text-lg font-semibold">Swap Assets</h3>
                          <p className="text-sm text-muted-foreground">Exchange your digital assets instantly</p>
                        </div>
                        <SwapWidget />
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="bridge" className="mt-6">
                      <div className="space-y-4">
                        <div className="text-center mb-4">
                          <h3 className="text-lg font-semibold">Bridge Assets</h3>
                          <p className="text-sm text-muted-foreground">Transfer assets between different chains</p>
                        </div>
                        <BridgeWidget />
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>

            {/* Additional Features */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-blue-500" />
                    Security First
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Your assets are protected with industry-leading security protocols. 
                    All transactions are secured on the blockchain with complete transparency.
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-green-500" />
                    Earn Rewards
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Participate in liquidity pools, stake your assets, and earn CATA rewards 
                    while contributing to the ecosystem.
                  </p>
                  <Button 
                    className="mt-4" 
                    variant="outline"
                    onClick={() => navigate('/dashboard/pools')}
                  >
                    Explore Pools
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* FAQ Section */}
            <div>
              <h2 className="text-2xl font-semibold mb-4">Frequently Asked Questions</h2>
              <DashboardFAQ />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Home;