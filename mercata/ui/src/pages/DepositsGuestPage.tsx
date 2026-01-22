import { Link } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogIn, PiggyBank, Shield, TrendingUp, Zap, ChevronRight } from 'lucide-react';
import { useCDP } from '@/context/CDPContext';

const DepositsGuestPage = () => {
  const { cdpAssets, loadingAssets } = useCDP();

  const handleLogin = () => {
    const theme = localStorage.getItem('theme') || 'light';
    window.location.href = `/login?theme=${theme}`;
  };

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Deposits" />
        <main className="flex-1 p-4 md:p-6 pb-16 md:pb-6 overflow-y-auto">
          <div className="space-y-6">
            {/* Hero Section */}
            <Card className="border-2 border-dashed bg-gradient-to-br from-blue-50/50 to-green-50/50 dark:from-blue-950/20 dark:to-green-950/20">
              <CardHeader className="text-center pb-2">
                <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-green-600 rounded-full flex items-center justify-center mb-4 shadow-lg">
                  <PiggyBank className="w-10 h-10 text-white" />
                </div>
                <CardTitle className="text-2xl">Grow Your Savings with STRATO</CardTitle>
                <CardDescription className="text-base max-w-lg mx-auto">
                  Deposit your assets and watch them grow. Earn competitive yields automatically 
                  with our simple and secure savings solution.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center space-y-6">
                {/* Key Features */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                  <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
                    <Shield className="w-8 h-8 text-blue-500" />
                    <span className="font-medium">Secure Deposits</span>
                    <span className="text-sm text-muted-foreground">Your assets stay safe</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
                    <TrendingUp className="w-8 h-8 text-green-500" />
                    <span className="font-medium">Earn Yields</span>
                    <span className="text-sm text-muted-foreground">Competitive returns</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
                    <Zap className="w-8 h-8 text-purple-500" />
                    <span className="font-medium">Instant Access</span>
                    <span className="text-sm text-muted-foreground">Withdraw anytime</span>
                  </div>
                </div>
                
                <Button 
                  onClick={handleLogin}
                  size="lg"
                  className="gap-2 px-8"
                >
                  <LogIn className="w-5 h-5" />
                  Sign In to Start Saving
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Available Deposit Assets - Public Info */}
            <Card>
              <CardHeader>
                <CardTitle>Available Deposit Assets</CardTitle>
                <CardDescription>
                  Assets you can deposit to earn yields on STRATO
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingAssets ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : cdpAssets && cdpAssets.length > 0 ? (
                  <div className="space-y-3">
                    {cdpAssets.filter(a => a.isSupported).map((asset) => (
                      <div key={asset.asset} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-green-100 dark:from-blue-900/30 dark:to-green-900/30 flex items-center justify-center">
                            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                              {asset.symbol?.charAt(0) || '?'}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium">{asset.symbol || 'Unknown'}</p>
                            <p className="text-sm text-muted-foreground">
                              {asset.asset?.slice(0, 6)}...{asset.asset?.slice(-4)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-green-600 dark:text-green-400">
                            Earn Yields
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Deposit to start
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No deposit assets available at this time.</p>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default DepositsGuestPage;
