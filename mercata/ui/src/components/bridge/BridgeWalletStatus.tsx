import React from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { Copy } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import CustomConnectButton from '@/components/ui/CustomConnectButton';

const BridgeWalletStatus = () => {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { toast } = useToast();

  const copyToClipboard = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      toast({
        title: 'Address copied!',
        description: 'Wallet address copied to clipboard',
        duration: 2000,
      });
    }
  };

  return (
    <div className="flex items-center gap-3 mb-4">
      {isConnected ? (
        <>
          <div
            onClick={() => disconnect()}
            className="relative group cursor-pointer"
          >
            <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl font-semibold group-hover:opacity-0 transition-opacity">
              Wallet Connected
            </div>
            <div className="absolute inset-0 bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-red-600 font-semibold">
                Disconnect
              </span>
            </div>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 text-xs bg-green-100/50 px-2 py-1 rounded-md font-mono text-green-700 cursor-pointer">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard();
                    }}
                    className="hover:text-green-900 transition-colors cursor-pointer"
                  >
                    <Copy size={12} />
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{address}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </>
      ) : (
        <CustomConnectButton label="Connect Wallet" />
      )}
    </div>
  );
};

export default BridgeWalletStatus; 