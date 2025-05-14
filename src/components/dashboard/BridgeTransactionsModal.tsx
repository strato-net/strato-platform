import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowLeftRight, Clock, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';

interface BridgeTransaction {
  id: string;
  fromChain: string;
  toChain: string;
  amount: string;
  status: 'pending' | 'approved' | 'completed' | 'failed';
  timestamp: string;
  hash: string;
}

interface BridgeTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BridgeTransactionsModal = ({ isOpen, onClose }: BridgeTransactionsModalProps) => {
  // Mock transactions data
  const transactions: BridgeTransaction[] = [
    {
      id: '1',
      fromChain: 'Ethereum',
      toChain: 'STRATO',
      amount: '1.5 ETH',
      status: 'completed',
      timestamp: '2024-03-20 14:30:00',
      hash: '0x123...abc'
    },
    {
      id: '2',
      fromChain: 'STRATO',
      toChain: 'Ethereum',
      amount: '2.0 ETH',
      status: 'pending',
      timestamp: '2024-03-20 15:45:00',
      hash: '0x456...def'
    },
    {
      id: '3',
      fromChain: 'Ethereum',
      toChain: 'STRATO',
      amount: '0.5 ETH',
      status: 'approved',
      timestamp: '2024-03-20 16:15:00',
      hash: '0x789...ghi'
    }
  ];

  const getStatusIcon = (status: BridgeTransaction['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-blue-500" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
    }
  };

  const getStatusText = (status: BridgeTransaction['status']) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'pending':
        return 'Pending Approval';
      case 'approved':
        return 'Approved';
      case 'failed':
        return 'Failed';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            Bridge Transactions
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-md">
            <h3 className="font-medium mb-2">Transaction Status Guide</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-500" />
                <span>Pending Approval</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-500" />
                <span>Approved</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>Completed</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span>Failed</span>
              </div>
            </div>
          </div>

          <div className="border rounded-md">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Transaction</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">From</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">To</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Amount</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Status</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{tx.id}</span>
                          <a 
                            href={`https://etherscan.io/tx/${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm">{tx.fromChain}</td>
                      <td className="py-3 px-4 text-sm">{tx.toChain}</td>
                      <td className="py-3 px-4 text-sm font-medium">{tx.amount}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(tx.status)}
                          <span className="text-sm">{getStatusText(tx.status)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">{tx.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BridgeTransactionsModal; 