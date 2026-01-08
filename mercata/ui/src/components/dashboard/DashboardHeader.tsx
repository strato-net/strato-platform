import { useUser } from '@/context/UserContext';
import { useAuthAction } from '@/hooks/useAuthAction';
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
  const { canPerformAction, redirectToLogin } = useAuthAction();
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
        {/* Back button for non-portfolio pages (both mobile and desktop) - uses browser history */}
        {!isPortfolioPage && (
          <button 
            onClick={() => navigate(-1)}
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
        <h1 className="text-base md:text-xl font-bold whitespace-nowrap">{title}</h1>
        {isTestnet && (
          <span className="bg-orange-500 text-white px-2 py-1 rounded text-xs font-bold uppercase hidden sm:inline-block">
            TESTNET
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <ModeToggle />
        
        {canPerformAction ? (
        <Popover>
          <PopoverTrigger asChild>
            <button className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-[#1e2a4a] flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity">
              <span className="text-white text-xs md:text-sm font-semibold">
                {userName?.slice(0, 2).toUpperCase() || "NA"}
              </span>
            </button>
          </PopoverTrigger>
          
          <PopoverContent className="w-64 md:w-72 p-3 md:p-4" align="end">
            <div className="space-y-3 md:space-y-4">
              {/* User Info */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#1e2a4a] flex items-center justify-center shrink-0">
                  <span className="text-white text-sm font-semibold">
                    {userName?.slice(0, 2).toUpperCase() || "NA"}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{userName || "N/A"}</p>
                  <div className="flex items-center gap-1.5 text-[10px] md:text-xs text-muted-foreground font-mono">
                    <span className="truncate">{truncateAddress(userAddress, 8, 4)}</span>
                    <button onClick={() => copyAddress(userAddress, 'User')} className="hover:text-foreground shrink-0">
                      <Copy size={10} />
                    </button>
                  </div>
                </div>
              </div>

              {/* External Wallet */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] md:text-xs font-medium text-muted-foreground">External Wallet</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] md:text-[10px] font-semibold ${
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
                          <div className="flex items-center gap-1.5 text-[10px] md:text-xs font-mono">
                            <span>{truncateAddress(walletAddress, 8, 4)}</span>
                            <button onClick={() => copyAddress(walletAddress, 'Wallet')} className="hover:text-foreground">
                              <Copy size={10} />
                            </button>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent><p>{walletAddress}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Button onClick={() => disconnect()} size="sm" className={`${GRADIENT_BUTTON_CLASS} h-8 text-xs`}>
                      Disconnect Wallet
                    </Button>
                  </div>
                ) : (
                  <ConnectButton.Custom>
                    {({ openConnectModal, mounted, authenticationStatus }) => {
                      if (!mounted || authenticationStatus === 'loading') return null;
                      return (
                        <Button onClick={openConnectModal} size="sm" className={`${GRADIENT_BUTTON_CLASS} h-8 text-xs`}>
                          Connect Wallet
                        </Button>
                      );
                    }}
                  </ConnectButton.Custom>
                )}
              </div>

              {/* Logout */}
              <div className="border-t pt-3">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={logout} 
                  className="w-full h-9 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 justify-start gap-2"
                >
                  <LogOutIcon size={16} />
                  <span className="text-sm font-medium">Logout</span>
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        ) : (
          <Button 
            onClick={redirectToLogin}
            size="sm"
            className="h-8 px-4 text-xs bg-strato-blue hover:bg-strato-blue/90 text-white"
          >
            Login
          </Button>
        )}
      </div>
    </header>
  );
};

export default DashboardHeader;
