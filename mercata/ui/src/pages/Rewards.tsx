import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gift, TrendingUp, ExternalLink, Clock, DollarSign } from "lucide-react";
import { Link } from "react-router-dom";
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';

// Mock data for rewards
const mockStakedAssets = [
  {
    id: 'musdst',
    name: 'mUSDST',
    symbol: 'mUSDST',
    stakedAmount: '1250.789456',
    usdValue: '1250.79',
    pendingRewards: '45.234567',
    totalRewardsEarned: '234.567890',
    poolType: 'Lending Pool',
    poolLink: '/dashboard/pools?tab=lending'
  },
  {
    id: 'silvst-usdst-lp',
    name: 'SILVST-USDST-LP',
    symbol: 'SILVST-USDST-LP',
    stakedAmount: '89.567123',
    usdValue: '892.15',
    pendingRewards: '12.456789',
    totalRewardsEarned: '67.890123',
    poolType: 'Swap Pool',
    poolLink: '/dashboard/pools?tab=swap'
  },
  {
    id: 'susdst',
    name: 'sUSDST',
    symbol: 'sUSDST',
    stakedAmount: '750.345678',
    usdValue: '750.35',
    pendingRewards: '23.123456',
    totalRewardsEarned: '156.789012',
    poolType: 'Safety Module',
    poolLink: '/dashboard/pools?tab=safety'
  }
];

const mockRewardsHistory = [
  {
    id: '1',
    timestamp: '2024-01-15T10:30:00Z',
    asset: 'mUSDST',
    amount: '15.234567',
    txHash: '0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f',
    type: 'claim'
  },
  {
    id: '2',
    timestamp: '2024-01-14T14:22:00Z',
    asset: 'SILVST-USDST-LP',
    amount: '8.567890',
    txHash: '0x2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3g',
    type: 'claim'
  },
  {
    id: '3',
    timestamp: '2024-01-13T09:15:00Z',
    asset: 'sUSDST',
    amount: '12.345678',
    txHash: '0x3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3g4h',
    type: 'claim'
  },
  {
    id: '4',
    timestamp: '2024-01-12T16:45:00Z',
    asset: 'mUSDST',
    amount: '18.901234',
    txHash: '0x4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3g4h5i',
    type: 'claim'
  },
  {
    id: '5',
    timestamp: '2024-01-11T11:30:00Z',
    asset: 'sUSDST',
    amount: '22.456789',
    txHash: '0x5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3g4h5i6j',
    type: 'claim'
  }
];

const formatDate = (timestamp: string) => {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Simple number formatting function to avoid BigInt issues
const formatNumber = (value: string, decimals: number = 6) => {
  const num = parseFloat(value);
  return num.toFixed(decimals);
};

const Rewards = () => {
  const [isCalculatingPending, setIsCalculatingPending] = useState(false);
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const [claimingAssets, setClaimingAssets] = useState<Set<string>>(new Set());
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Calculate totals from mock data
  const totalUsdValue = mockStakedAssets.reduce((sum, asset) => sum + parseFloat(asset.usdValue), 0);
  const totalRewardsEarned = mockStakedAssets.reduce((sum, asset) => sum + parseFloat(asset.totalRewardsEarned), 0);
  const totalPendingRewards = mockStakedAssets.reduce((sum, asset) => sum + parseFloat(asset.pendingRewards), 0);

  const handleCalculatePending = async () => {
    setIsCalculatingPending(true);
    // Mock delay for on-chain calculation
    setTimeout(() => {
      setIsCalculatingPending(false);
    }, 2000);
  };

  const handleClaimAll = async () => {
    setIsClaimingAll(true);
    // Mock delay for claiming all
    setTimeout(() => {
      setIsClaimingAll(false);
    }, 3000);
  };

  const handleClaimAsset = async (assetId: string) => {
    setClaimingAssets(prev => new Set(prev).add(assetId));
    // Mock delay for claiming individual asset
    setTimeout(() => {
      setClaimingAssets(prev => {
        const newSet = new Set(prev);
        newSet.delete(assetId);
        return newSet;
      });
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Rewards" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6 space-y-6">
          <div className="flex items-center gap-3 mb-6">
            <Gift className="h-8 w-8 text-strato-blue" />
            <h1 className="text-3xl font-bold">Rewards</h1>
          </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Staked Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalUsdValue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Across all pools</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Rewards Earned</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRewardsEarned.toFixed(6)} CATA</div>
            <p className="text-xs text-muted-foreground">All-time earnings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Rewards</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPendingRewards.toFixed(6)} CATA</div>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCalculatePending}
                disabled={isCalculatingPending}
                className="text-xs"
              >
                {isCalculatingPending ? "Calculating..." : "Recalculate"}
              </Button>
              <Button
                size="sm"
                onClick={handleClaimAll}
                disabled={isClaimingAll || totalPendingRewards === 0}
                className="text-xs bg-strato-blue hover:bg-strato-blue/90"
              >
                {isClaimingAll ? "Claiming..." : "Claim All"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Staked Assets */}
      <Card>
        <CardHeader>
          <CardTitle>Staked Assets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockStakedAssets.map((asset) => (
              <div key={asset.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{asset.name}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {asset.poolType}
                    </Badge>
                  </div>
                  <div className="text-sm text-gray-600">
                    Staked: {formatNumber(asset.stakedAmount)} {asset.symbol}
                  </div>
                  <div className="text-sm text-gray-600">
                    Value: ${asset.usdValue}
                  </div>
                  <div className="text-sm text-gray-600">
                    Total Earned: {formatNumber(asset.totalRewardsEarned)} CATA
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-3 sm:mt-0">
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      Pending: {formatNumber(asset.pendingRewards)} CATA
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleClaimAsset(asset.id)}
                      disabled={claimingAssets.has(asset.id) || parseFloat(asset.pendingRewards) === 0}
                      className="bg-strato-blue hover:bg-strato-blue/90"
                    >
                      {claimingAssets.has(asset.id) ? "Claiming..." : "Claim"}
                    </Button>
                    <Link to={asset.poolLink}>
                      <Button size="sm" variant="outline">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Manage
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Rewards History */}
      <Card>
        <CardHeader>
          <CardTitle>Rewards History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Asset</th>
                  <th className="text-right py-2">Amount</th>
                  <th className="text-left py-2">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {mockRewardsHistory.map((entry) => (
                  <tr key={entry.id} className="border-b">
                    <td className="py-3">{formatDate(entry.timestamp)}</td>
                    <td className="py-3">
                      <Badge variant="outline" className="text-xs">
                        {entry.asset}
                      </Badge>
                    </td>
                    <td className="py-3 text-right font-medium">
                      +{formatNumber(entry.amount)} CATA
                    </td>
                    <td className="py-3">
                      <a
                        href={`https://etherscan.io/tx/${entry.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-mono text-xs"
                      >
                        {entry.txHash.slice(0, 8)}...{entry.txHash.slice(-6)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
        </main>
      </div>
    </div>
  );
};

export default Rewards;