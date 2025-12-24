import { Avatar, AvatarFallback } from "../ui/avatar";
import { useUser } from '@/context/UserContext';
import { useNetwork } from '@/context/NetworkContext';
import { useTheme } from 'next-themes';
import { LogOutIcon, Copy, ChevronLeft } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAccount, useDisconnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { ModeToggle } from '../mode-toggle';
import { useNavigate, useLocation } from 'react-router-dom';
import STRATOICON from '@/assets/icon.png';
import STRATOICONDARK from '@/assets/dark-theme-strato-compressed-logo.png';

interface DashboardHeaderProps {
  title: string;
}

const GRADIENT_BUTTON_CLASS = "w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90";

const DashboardHeader = ({ title }: DashboardHeaderProps) => {
  const { userAddress, userName, logout } = useUser();
  const { isTestnet } = useNetwork();
  const { resolvedTheme } = useTheme();
  const { address: walletAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isPortfolioPage = pathname === '/dashboard';

  const truncateAddress = (address: string | null | undefined, front = 6, back = 4) => {
    if (!address || address.length <= front + back) return address || "N/A";
    return `${address.slice(0, front)}...${address.slice(-back)}`;
  };

  const copyAddress = async (address: string | null, label: string) => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast({ title: 'Address copied!', description: `${label} address copied to clipboard`, duration: 2000 });
  };

  return (
    <header className="bg-background border-b border-border py-4 px-4 md:px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 md:gap-3">
        {/* Back button for non-portfolio pages (both mobile and desktop) */}
        {!isPortfolioPage && (
          <button 
            onClick={() => navigate('/dashboard')}
            className="flex items-center justify-center p-1 hover:bg-muted rounded-md transition-colors"
          >
            <ChevronLeft size={20} className="text-muted-foreground" />
          </button>
        )}
        {/* Logo on mobile, hidden on desktop */}
        <img 
          src={resolvedTheme === 'dark' ? STRATOICONDARK : STRATOICON} 
          alt="STRATO" 
          className="h-8 md:hidden" 
        />
        {/* Title always visible */}
        <h1 className="text-xl font-bold">{title}</h1>
        {isTestnet && (
          <span className="bg-orange-500 text-white px-2 py-1 rounded text-xs font-bold uppercase hidden sm:inline-block">
            TESTNET
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <ModeToggle />
        
        <Popover>
          <PopoverTrigger asChild>
            <Avatar className="w-9 h-9 bg-strato-blue cursor-pointer">
              <AvatarFallback className="text-white text-sm bg-strato-blue">
                {userName?.slice(0, 2).toUpperCase() || "NA"}
              </AvatarFallback>
            </Avatar>
          </PopoverTrigger>
          
          <PopoverContent className="w-72 p-4" align="end">
            <div className="space-y-4">
              {/* User Info */}
              <div>
                <p className="font-medium">{userName || "N/A"}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono mt-1">
                  <span>{truncateAddress(userAddress, 12, 6)}</span>
                  <button onClick={() => copyAddress(userAddress, 'User')} className="hover:text-foreground">
                    <Copy size={12} />
                  </button>
                </div>
              </div>

              {/* External Wallet */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">External Wallet</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    isConnected ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                  }`}>
                    {isConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>
                
                {isConnected ? (
                  <div className="space-y-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 text-xs font-mono">
                            <span>{truncateAddress(walletAddress, 12, 6)}</span>
                            <button onClick={() => copyAddress(walletAddress, 'Wallet')} className="hover:text-foreground">
                              <Copy size={12} />
                            </button>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent><p>{walletAddress}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Button onClick={() => disconnect()} className={GRADIENT_BUTTON_CLASS}>
                      Disconnect Wallet
                    </Button>
                  </div>
                ) : (
                  <ConnectButton.Custom>
                    {({ openConnectModal, mounted, authenticationStatus }) => {
                      if (!mounted || authenticationStatus === 'loading') return null;
                      return (
                        <Button onClick={openConnectModal} className={GRADIENT_BUTTON_CLASS}>
                          Connect Wallet
                        </Button>
                      );
                    }}
                  </ConnectButton.Custom>
                )}
              </div>

              {/* Logout */}
              <div className="border-t pt-4">
                <Button variant="destructive" size="sm" onClick={logout} className="w-full">
                  <LogOutIcon className="mr-2" size={16} />
                  Logout
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
};

export default DashboardHeader;
