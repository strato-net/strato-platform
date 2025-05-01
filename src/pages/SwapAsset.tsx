
import { useEffect, useState } from 'react';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowDownUp, Check, ChevronDown } from 'lucide-react';

type AssetType = {
  name: string;
  symbol: string;
  balance: string;
  icon: string;
}

const SwapAsset = () => {
  useEffect(() => {
    document.title = "Swap Assets | STRATO Mercata";
  }, []);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [fromAsset, setFromAsset] = useState<AssetType>({
    name: 'Bitcoin',
    symbol: 'BTC',
    balance: '0.0023',
    icon: '₿'
  });
  const [toAsset, setToAsset] = useState<AssetType>({
    name: 'Ethereum',
    symbol: 'ETH',
    balance: '0.125',
    icon: 'Ξ'
  });
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');

  const assets: AssetType[] = [
    { name: 'Bitcoin', symbol: 'BTC', balance: '0.0023', icon: '₿' },
    { name: 'Ethereum', symbol: 'ETH', balance: '0.125', icon: 'Ξ' },
    { name: 'CATA', symbol: 'CATA', balance: '287.53', icon: 'C' },
    { name: 'USD Stable Token', symbol: 'USDT', balance: '156.23', icon: '$' }
  ];

  const handleSwapAssets = () => {
    const temp = fromAsset;
    setFromAsset(toAsset);
    setToAsset(temp);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  const handleFromAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFromAmount(e.target.value);
    // Simple mock exchange rate calculation
    const rate = 15.3; // Mock rate for demo
    setToAmount(e.target.value ? (parseFloat(e.target.value) * rate).toFixed(6) : '');
  };

  const handleSwap = () => {
    setIsDialogOpen(false);
    // Here you would normally handle the actual swap transaction
    // and then show a success message
    alert(`Swap successful: ${fromAmount} ${fromAsset.symbol} to ${toAmount} ${toAsset.symbol}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title="Swap Assets" />
        
        <main className="p-6">
          <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-6">Exchange your digital assets</h2>
            
            <div className="space-y-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-600">From</label>
                  <span className="text-sm text-gray-600">
                    Balance: {fromAsset.balance} {fromAsset.symbol}
                  </span>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="number"
                    value={fromAmount}
                    onChange={handleFromAmountChange}
                    placeholder="0.00"
                    className="bg-transparent border-none text-lg font-medium focus:outline-none flex-1"
                  />
                  
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="flex items-center gap-2">
                        <span className="font-mono">{fromAsset.icon}</span>
                        <span>{fromAsset.symbol}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0">
                      <div className="flex flex-col">
                        {assets.map((asset) => (
                          <Button
                            key={asset.symbol}
                            variant="ghost"
                            className="justify-start gap-2"
                            onClick={() => setFromAsset(asset)}
                          >
                            <span className="font-mono">{asset.icon}</span>
                            <span>{asset.symbol}</span>
                            {asset.symbol === fromAsset.symbol && (
                              <Check className="h-4 w-4 ml-auto" />
                            )}
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              <div className="flex justify-center">
                <Button 
                  onClick={handleSwapAssets} 
                  variant="outline" 
                  size="icon"
                  className="rounded-full bg-gray-100"
                >
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <label className="text-sm text-gray-600">To</label>
                  <span className="text-sm text-gray-600">
                    Balance: {toAsset.balance} {toAsset.symbol}
                  </span>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="text"
                    value={toAmount}
                    readOnly
                    placeholder="0.00"
                    className="bg-transparent border-none text-lg font-medium focus:outline-none flex-1 text-gray-700"
                  />
                  
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="flex items-center gap-2">
                        <span className="font-mono">{toAsset.icon}</span>
                        <span>{toAsset.symbol}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0">
                      <div className="flex flex-col">
                        {assets.map((asset) => (
                          <Button
                            key={asset.symbol}
                            variant="ghost"
                            className="justify-start gap-2"
                            onClick={() => setToAsset(asset)}
                          >
                            <span className="font-mono">{asset.icon}</span>
                            <span>{asset.symbol}</span>
                            {asset.symbol === toAsset.symbol && (
                              <Check className="h-4 w-4 ml-auto" />
                            )}
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              
              <div className="flex flex-col gap-2 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Exchange Rate</span>
                  <span className="font-medium">1 {fromAsset.symbol} ≈ 15.3 {toAsset.symbol}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Network Fee</span>
                  <span className="font-medium">0.0001 {fromAsset.symbol}</span>
                </div>
              </div>
              
              <Button 
                className="w-full bg-blue-600 hover:bg-blue-700" 
                onClick={() => setIsDialogOpen(true)}
                disabled={!fromAmount}
              >
                Swap Assets
              </Button>
            </div>
          </div>
        </main>
      </div>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Swap</DialogTitle>
            <DialogDescription>
              Please review your transaction details before confirming.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="flex justify-between">
              <span className="text-gray-600">You pay:</span>
              <span className="font-semibold">{fromAmount} {fromAsset.symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">You receive:</span>
              <span className="font-semibold">{toAmount} {toAsset.symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Exchange rate:</span>
              <span>1 {fromAsset.symbol} ≈ 15.3 {toAsset.symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Network fee:</span>
              <span>0.0001 {fromAsset.symbol}</span>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSwap}>Confirm Swap</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SwapAsset;
