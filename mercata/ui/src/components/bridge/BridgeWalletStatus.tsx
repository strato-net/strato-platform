import React from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import { Copy } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

interface BridgeWalletStatusProps {
  guestMode?: boolean;
  externalOnly?: boolean;
  connectedLabel?: string;
  connectLabel?: string;
  copiedDescription?: string;
}

const CONNECT_BUTTON_CLASS =
  'w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white px-4 py-2 rounded-xl font-semibold transition-all flex items-center justify-center hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed';

const isStratoConnector = (connector: { id: string; name: string }) =>
  connector.id === 'stratoWallet' || connector.name === 'STRATO Wallet';

const BridgeWalletStatus: React.FC<BridgeWalletStatusProps> = ({
  guestMode = false,
  externalOnly = false,
  connectedLabel = 'Wallet Connected',
  connectLabel = 'Connect Wallet',
  copiedDescription = 'Wallet address copied to clipboard',
}) => {
  const { address, connector, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connectModalOpen, openConnectModal } = useConnectModal();
  const { toast } = useToast();
  const externalModalActiveRef = React.useRef(false);
  const hasConnectedWallet =
    isConnected && (!externalOnly || (connector ? !isStratoConnector(connector) : false));

  const hideStratoWalletOption = React.useCallback(() => {
    const stratoOption = document.querySelector<HTMLElement>(
      '[data-testid="rk-wallet-option-stratoWallet"]'
    );
    if (!stratoOption) return;

    stratoOption.style.display = 'none';

    const stratoRow = stratoOption.parentElement as HTMLElement | null;
    if (stratoRow) {
      stratoRow.style.display = 'none';
    }

    const walletList = stratoRow?.parentElement;
    const onlyStratoInList =
      walletList?.querySelectorAll('[data-testid^="rk-wallet-option-"]').length === 1;
    if (!walletList || !onlyStratoInList) return;

    walletList.style.display = 'none';
    const groupHeader = walletList.previousElementSibling as HTMLElement | null;
    if (groupHeader?.textContent?.trim() === 'STRATO') {
      groupHeader.style.display = 'none';
    }
  }, []);

  const restoreStratoWalletOption = React.useCallback(() => {
    const stratoOption = document.querySelector<HTMLElement>(
      '[data-testid="rk-wallet-option-stratoWallet"]'
    );
    if (!stratoOption) return;

    stratoOption.style.display = '';

    const stratoRow = stratoOption.parentElement as HTMLElement | null;
    if (stratoRow) {
      stratoRow.style.display = '';
    }

    const walletList = stratoRow?.parentElement as HTMLElement | null;
    if (walletList) {
      walletList.style.display = '';
      const groupHeader = walletList.previousElementSibling as HTMLElement | null;
      if (groupHeader?.textContent?.trim() === 'STRATO') {
        groupHeader.style.display = '';
      }
    }
  }, []);

  React.useEffect(() => {
    if (!connectModalOpen) {
      externalModalActiveRef.current = false;
      restoreStratoWalletOption();
      return;
    }

    if (!externalOnly || !externalModalActiveRef.current) return;

    hideStratoWalletOption();
    const observer = new MutationObserver(hideStratoWalletOption);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      restoreStratoWalletOption();
    };
  }, [connectModalOpen, externalOnly, hideStratoWalletOption, restoreStratoWalletOption]);

  const copyToClipboard = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      toast({
        title: 'Address copied!',
        description: copiedDescription,
        duration: 2000,
      });
    }
  };

  const connectControl = externalOnly ? (
    <button
      type="button"
      disabled={guestMode}
      className={CONNECT_BUTTON_CLASS}
      onClick={() => {
        externalModalActiveRef.current = true;
        // If STRATO wallet is connected via wagmi, disconnect it first so modal can open
        if (isConnected && connector && isStratoConnector(connector)) {
          disconnect();
        }
        openConnectModal?.();
      }}
    >
      {connectLabel}
    </button>
  ) : (
    <ConnectButton label={connectLabel} />
  );

  return (
    <div className="w-full mb-4">
      {hasConnectedWallet ? (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full">
          <div
            onClick={() => disconnect()}
            className="relative group cursor-pointer flex-1"
          >
            <div className="px-3 sm:px-4 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl font-semibold group-hover:opacity-0 transition-opacity w-full text-center h-[38px] sm:h-[42px] flex items-center justify-center text-sm sm:text-base">
              {connectedLabel}
            </div>
            <div className="absolute inset-0 bg-destructive/10 border border-destructive/20 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-destructive font-semibold text-sm sm:text-base">
                Disconnect
              </span>
            </div>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center gap-2 text-xs bg-emerald-500/10 border border-emerald-500/20 px-3 sm:px-2 py-2 rounded-xl font-mono text-emerald-600 dark:text-emerald-400 cursor-pointer flex-1 h-[38px] sm:h-[42px]">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard();
                    }}
                    className="hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer"
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
        <div className={`w-full [&_button]:!w-full [&_button]:bg-gradient-to-r [&_button]:from-[#1f1f5f] [&_button]:via-[#293b7d] [&_button]:to-[#16737d] [&_button]:text-white [&_button]:px-4 [&_button]:py-2 [&_button]:rounded-xl [&_button]:font-semibold [&_button]:transition-all [&_button]:flex [&_button]:items-center [&_button]:justify-center ${guestMode ? '[&_button]:opacity-50 [&_button]:cursor-not-allowed pointer-events-none' : '[&_button]:hover:opacity-90'}`}>
          {connectControl}
        </div>
      )}
    </div>
  );
};

export default BridgeWalletStatus;
