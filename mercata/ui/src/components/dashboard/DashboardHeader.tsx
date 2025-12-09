import { Avatar, AvatarFallback } from "../ui/avatar";
import { useUser } from '@/context/UserContext';
import CopyButton from '../ui/copy';
import { LogOutIcon, Menu, Copy } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAccount, useDisconnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { ModeToggle } from '../mode-toggle';

interface DashboardHeaderProps {
  title: string;
  onMenuClick?: () => void;
}

const GRADIENT_BUTTON_CLASS = "w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90";

const DashboardHeader = ({ title, onMenuClick }: DashboardHeaderProps) => {
  const { userAddress, userName, logout } = useUser();
  const { address: walletAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { toast } = useToast();

  const truncateAddress = (address: string | null | undefined, front: number = 6, back: number = 4) => {
    if (!address) return "N/A";
    if (address.length <= front + back) return address;
    return `${address.substring(0, front)}...${address.substring(address.length - back)}`;
  };

  const copyAddress = async (address: string | null, label: string) => {
    if (address) {
      await navigator.clipboard.writeText(address);
      toast({
        title: 'Address copied!',
        description: `${label} address copied to clipboard`,
        duration: 2000,
      });
    }
  };

  const AddressRow = ({ address, onCopy, showTooltip = false, textColor = "text-foreground" }: { 
    address: string | null; 
    onCopy: () => void;
    showTooltip?: boolean;
    textColor?: string;
  }) => {
    const content = (
      <div className={`flex items-center justify-between w-full gap-1 text-xs font-mono ${textColor} cursor-pointer`}>
        <span className="flex-1 min-w-0">{truncateAddress(address, 16, 8)}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="hover:text-foreground transition-colors flex-shrink-0"
        >
          <Copy size={12} />
        </button>
      </div>
    );

    if (showTooltip && address) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent>
              <p>{address}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return content;
  };

  return (
    <header className="bg-background border-b border-border py-4 px-6 flex items-center justify-between">
      <div className="flex items-center">
        <button
          onClick={onMenuClick}
          className="md:hidden mr-4 p-2 hover:bg-muted rounded-md"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-xl font-bold">{title}</h1>
      </div>

      <div className="flex items-center space-x-4">
        <ModeToggle />
        <div className="flex items-center">
          <div className="flex flex-col items-end mr-3">
            <span className="text-sm font-medium">{userName || "N/A"}</span>
            <div className="flex items-center">
              <span className="text-xs text-muted-foreground">{truncateAddress(userAddress)}</span>
              <CopyButton address={userAddress}/>
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <div className="relative">
                <Avatar className="w-8 h-8 bg-strato-blue cursor-pointer">
                  <AvatarFallback className="text-white text-xs bg-strato-blue">
                    {userName ? userName.substring(0, 2).toUpperCase() : "NA"}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={`absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                    isConnected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-full p-3 shadow-md mt-2" align="end" side="bottom">
              <div className="flex flex-col space-y-3">
                <div className="flex flex-col space-y-0.5">
                  <div className="text-sm font-medium">{userName || "N/A"}</div>
                  <AddressRow 
                    address={userAddress} 
                    onCopy={() => copyAddress(userAddress, 'User')}
                    textColor="text-muted-foreground"
                  />
                </div>

                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-medium text-muted-foreground">External Wallet</div>
                    <div
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        isConnected ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                      }`}
                    >
                      {isConnected ? "Connected" : "Disconnected"}
                    </div>
                  </div>
                  {isConnected ? (
                    <div className="flex flex-col space-y-2">
                      <AddressRow 
                        address={walletAddress} 
                        onCopy={() => copyAddress(walletAddress, 'Wallet')}
                        showTooltip
                      />
                      <Button onClick={() => disconnect()} className={GRADIENT_BUTTON_CLASS}>
                        Disconnect Wallet
                      </Button>
                    </div>
                  ) : (
                    <ConnectButton.Custom>
                      {({ openConnectModal, authenticationStatus, mounted }) => {
                        const ready = mounted && authenticationStatus !== 'loading';
                        if (!ready) return null;

                        return (
                          <Button onClick={openConnectModal} className={GRADIENT_BUTTON_CLASS}>
                            Connect Wallet
                          </Button>
                        );
                      }}
                    </ConnectButton.Custom>
                  )}
                </div>

                <div className="border-t border-border pt-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={logout}
                    className="w-full"
                  >
                    <LogOutIcon />
                    Logout
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
