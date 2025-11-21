import React from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Copy } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

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
    <div className="w-full mb-4">
      {isConnected ? (
        <div className="flex items-center gap-3 w-full">
          <div
            onClick={() => disconnect()}
            className="relative group cursor-pointer flex-1"
          >
            <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl font-semibold group-hover:opacity-0 transition-opacity w-full text-center h-[42px] flex items-center justify-center">
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
                <div className="flex items-center justify-center gap-2 text-xs bg-green-100/50 px-2 py-2 rounded-md font-mono text-green-700 cursor-pointer flex-1 h-[42px]">
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
        </div>
      ) : (
        <div className="w-full [&_button]:!w-full [&_button]:bg-gradient-to-r [&_button]:from-[#1f1f5f] [&_button]:via-[#293b7d] [&_button]:to-[#16737d] [&_button]:text-white [&_button]:px-4 [&_button]:py-2 [&_button]:rounded-xl [&_button]:font-semibold [&_button]:hover:opacity-90 [&_button]:transition-all [&_button]:flex [&_button]:items-center [&_button]:justify-center">
          <ConnectButton label={"Connect Wallet"} />
        </div>
      )}
    </div>
  );
};

export default BridgeWalletStatus; 