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
    <div className="w-full mb-2 md:mb-4">
      {isConnected ? (
        <div className="flex items-center gap-1.5 md:gap-2 w-full">
          <div
            onClick={() => disconnect()}
            className="relative group cursor-pointer shrink-0"
          >
            <div className="px-2 md:px-3 py-1.5 md:py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] md:text-xs font-semibold group-hover:opacity-0 transition-opacity text-center h-[32px] md:h-[38px] flex items-center justify-center whitespace-nowrap">
              Wallet Connected
            </div>
            <div className="absolute inset-0 bg-destructive/10 border border-destructive/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-destructive text-[10px] md:text-xs font-semibold">Disconnect</span>
            </div>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center gap-1 text-[10px] md:text-xs bg-emerald-500/10 border border-emerald-500/20 px-2 md:px-3 py-1.5 md:py-2 rounded-lg font-mono text-emerald-600 dark:text-emerald-400 cursor-pointer flex-1 h-[32px] md:h-[38px]">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard();
                    }}
                    className="hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer"
                  >
                    <Copy size={10} className="md:w-3 md:h-3" />
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
        <div className="w-full [&_button]:!w-full [&_button]:bg-primary [&_button]:hover:bg-primary/90 [&_button]:text-primary-foreground [&_button]:px-4 [&_button]:py-2 [&_button]:rounded-lg [&_button]:font-semibold [&_button]:transition-all [&_button]:flex [&_button]:items-center [&_button]:justify-center">
          <ConnectButton label={"Connect Wallet"} />
        </div>
      )}
    </div>
  );
};

export default BridgeWalletStatus;
