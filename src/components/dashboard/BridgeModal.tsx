import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeftRight, ArrowDownUp, History } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BridgeTransactionsModal from './BridgeTransactionsModal';

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BridgeModal = ({ isOpen, onClose }: BridgeModalProps) => {
  const [amount, setAmount] = useState('');
  const [fromChain, setFromChain] = useState('ethereum');
  const [toChain, setToChain] = useState('strato');
  const [loading, setLoading] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const { toast } = useToast();

  const handleBridge = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement bridging logic
      toast({
        title: "Success",
        description: "Your bridge request has been submitted. Please check the transaction status.",
      });
      onClose();
      setShowTransactions(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to bridge assets. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const swapChains = () => {
    const temp = fromChain;
    setFromChain(toChain);
    setToChain(temp);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="h-5 w-5" />
                Bridge Assets
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2"
                onClick={() => setShowTransactions(true)}
              >
                <History className="h-4 w-4" />
                View Transactions
              </Button>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="asset">Select Asset</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an asset" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eth">Ethereum (ETH)</SelectItem>
                    <SelectItem value="usdc">USD Coin (USDC)</SelectItem>
                    <SelectItem value="usdt">Tether (USDT)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="Enter amount"
                  className="w-full"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="from">From Network</Label>
                <Select value={fromChain} onValueChange={setFromChain}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ethereum">Ethereum</SelectItem>
                    <SelectItem value="strato">STRATO</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="to">To Network</Label>
                <Select value={toChain} onValueChange={setToChain}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ethereum">Ethereum</SelectItem>
                    <SelectItem value="strato">STRATO</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={swapChains}
                  className="rounded-full"
                >
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-md space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Bridge Fee:</span>
                <span>0.1%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Estimated Time:</span>
                <span>2-5 minutes</span>
              </div>
            </div>

            <div className="text-sm text-gray-500">
              <p>• Bridge assets between Ethereum and STRATO networks</p>
              <p>• Small bridge fee applies</p>
              <p>• Transaction time varies by network congestion</p>
              <p>• STRATO to Ethereum transfers require approval</p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={onClose} className="mr-2">
              Cancel
            </Button>
            <Button 
              onClick={handleBridge} 
              disabled={loading || !amount}
              className="bg-strato-blue hover:bg-strato-blue/90"
            >
              {loading ? 'Processing...' : 'Bridge Assets'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BridgeTransactionsModal
        isOpen={showTransactions}
        onClose={() => setShowTransactions(false)}
      />
    </>
  );
};

export default BridgeModal; 