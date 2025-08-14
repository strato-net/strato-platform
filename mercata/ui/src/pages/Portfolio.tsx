import { useState, useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { useLendingContext } from "@/context/LendingContext";
import { formatUnits } from "viem";
import PortfolioChart from "@/components/portfolio/PortfolioChart";
import PortfolioStats from "@/components/portfolio/PortfolioStats";
import AssetAllocation from "@/components/portfolio/AssetAllocation";
import AssetsList from "@/components/dashboard/AssetsList";
import ActivityFeedList from "@/components/dashboard/ActivityFeedList";
import BorrowingSection from "@/components/dashboard/BorrowingSection";
import MyPoolParticipationSection from "@/components/dashboard/MyPoolParticipationSection";
import { TrendingUp, PieChart, Activity, Wallet } from "lucide-react";

const Portfolio = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { userAddress } = useUser();
  const { activeTokens: tokens, inactiveTokens, loading, fetchTokens } = useUserTokens();
  const { loans, refreshLoans } = useLendingContext();
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [totalDebt, setTotalDebt] = useState<number>(0);
  const [netWorth, setNetWorth] = useState<number>(0);

  useEffect(() => {
    document.title = "Portfolio | STRATO Mercata";
    fetchTokens();
    refreshLoans();
  }, [userAddress]);

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;

    let total = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const rawPrice = token?.price || "0";
      const rawBalance = token?.balance || "0";
      const rawCollateralBalance = token?.collateralBalance || "0";

      const price = parseFloat(formatUnits(BigInt(rawPrice), 18));
      const balance = parseFloat(formatUnits(BigInt(rawBalance), 18));
      const collateralBalance = parseFloat(formatUnits(BigInt(rawCollateralBalance), 18));

      const totalTokenValue = (balance + collateralBalance) * price;
      total += totalTokenValue;
    }

    const usdstBorrowed = loans?.totalAmountOwed 
      ? parseFloat(formatUnits(BigInt(loans.totalAmountOwed), 18))
      : 0;

    setTotalBalance(total);
    setTotalDebt(usdstBorrowed);
    setNetWorth(total - usdstBorrowed);
  }, [tokens, loans]);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />

      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader 
          title="Portfolio" 
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <main className="p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Portfolio Overview Stats */}
            <PortfolioStats 
              totalBalance={totalBalance}
              totalDebt={totalDebt}
              netWorth={netWorth}
              tokens={tokens}
            />

            {/* Portfolio Performance Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-500" />
                  Portfolio Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PortfolioChart 
                  tokens={tokens}
                  currentValue={netWorth}
                />
              </CardContent>
            </Card>

            {/* Borrowing and Pool Participation Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BorrowingSection loanData={loans} />
              <MyPoolParticipationSection />
            </div>

            {/* Two Column Layout for Allocation and Top Assets */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Asset Allocation Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-5 w-5 text-purple-500" />
                    Asset Allocation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <AssetAllocation tokens={tokens} />
                </CardContent>
              </Card>

              {/* Top Performing Assets */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-green-500" />
                    Top Holdings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {tokens
                      .sort((a, b) => {
                        const aValue = parseFloat(formatUnits(BigInt(a.balance || "0"), 18)) * 
                                      parseFloat(formatUnits(BigInt(a.price || "0"), 18));
                        const bValue = parseFloat(formatUnits(BigInt(b.balance || "0"), 18)) * 
                                      parseFloat(formatUnits(BigInt(b.price || "0"), 18));
                        return bValue - aValue;
                      })
                      .slice(0, 5)
                      .map((token, index) => {
                        const balance = parseFloat(formatUnits(BigInt(token.balance || "0"), 18));
                        const price = parseFloat(formatUnits(BigInt(token.price || "0"), 18));
                        const value = balance * price;
                        const percentage = totalBalance > 0 ? (value / totalBalance) * 100 : 0;

                        return (
                          <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{index + 1}.</span>
                                {token.images?.[0]?.value ? (
                                  <img
                                    src={token.images[0].value}
                                    alt={token._name}
                                    className="w-6 h-6 rounded-full"
                                  />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                                    {token._symbol?.slice(0, 1)}
                                  </div>
                                )}
                                <div>
                                  <div className="font-medium">{token._symbol}</div>
                                  <div className="text-xs text-gray-500">
                                    {balance.toFixed(2)} @ ${price.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium">${value.toFixed(2)}</div>
                              <div className="text-xs text-gray-500">{percentage.toFixed(1)}%</div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabbed Section for Assets and Activity */}
            <Card>
              <CardContent className="p-0">
                <Tabs defaultValue="assets" className="w-full">
                  <div className="border-b">
                    <TabsList className="w-full justify-start rounded-none bg-transparent h-auto p-0">
                      <TabsTrigger 
                        value="assets" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3"
                      >
                        <Wallet className="h-4 w-4 mr-2" />
                        All Assets
                      </TabsTrigger>
                      <TabsTrigger 
                        value="activity"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3"
                      >
                        <Activity className="h-4 w-4 mr-2" />
                        Recent Activity
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  
                  <TabsContent value="assets" className="m-0">
                    <AssetsList
                      loading={loading}
                      tokens={tokens}
                      inActiveTokens={inactiveTokens}
                      isDashboard={false}
                      shouldPreventFlash={true}
                    />
                  </TabsContent>
                  
                  <TabsContent value="activity" className="m-0 p-6">
                    <ActivityFeedList />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Portfolio;