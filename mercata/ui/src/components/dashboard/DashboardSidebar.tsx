import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { LayoutDashboard, Wallet, ArrowLeft, ArrowRight, Book, ArrowRightLeft, Send, Shield, Activity, BarChart3, Coins, Droplets, Download, ScanQrCode } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import STRATOLOGO from '@/assets/strato.png';
import STRATOLOGODARK from '@/assets/strato-dark.png';
import MERCATAICON from '@/assets/icon.png';
import MERCATAICONDARK from '@/assets/dark-theme-strato-compressed-logo.png';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const DashboardSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { logout, isAdmin } = useUser();
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === 'dark' ? STRATOLOGODARK : STRATOLOGO;
  const icon = resolvedTheme === 'dark' ? MERCATAICONDARK : MERCATAICON;

  useEffect(() => {
    // Update CSS variable when collapsed state changes - only on desktop
    const updateSidebarWidth = () => {
      if (window.innerWidth >= 768) { // md breakpoint
        document.documentElement.style.setProperty(
          '--sidebar-width',
          collapsed ? '4rem' : '16rem'
        );
      } else {
        document.documentElement.style.setProperty('--sidebar-width', '0rem');
      }
    };

    updateSidebarWidth();
    window.addEventListener('resize', updateSidebarWidth);

    return () => window.removeEventListener('resize', updateSidebarWidth);
  }, [collapsed]);

  const allNavItems = [
    { icon: <LayoutDashboard size={20} />, label: 'Overview', path: '/dashboard' },
    { icon: <Wallet size={20} />, label: 'Deposits', path: '/dashboard/deposits' },
    { icon: <Send size={20} />, label: 'Transfer', path: '/dashboard/transfer' },
    { icon: <ScanQrCode size={20} />, label: 'Scan to Pay', path: '/dashboard/scan-to-pay' },
    { icon: <Book size={20} />, label: 'Borrow', path: '/dashboard/borrow' },
    { icon: <ArrowRightLeft size={20} />, label: 'Swap', path: '/dashboard/swap' },
    { icon: <Droplets size={20} />, label: 'Advanced', path: '/dashboard/advanced' },
    { icon: <Coins size={20} />, label: 'Rewards', path: '/dashboard/rewards' },
    { icon: <BarChart3 size={20} />, label: 'Mercata Stats', path: '/dashboard/stats' },
    { icon: <Download size={20} />, label: 'Withdrawals', path: '/dashboard/withdrawals' },
    { icon: <Activity size={20} />, label: 'Activity Feed', path: '/dashboard/activity' },
    { icon: <Shield size={20} />, label: 'Admin', path: '/dashboard/admin' },
  ];

  const navItems = allNavItems.filter(item => item.label !== 'Admin' || isAdmin);

  const isActive = (itemPath: string) => {
    if (itemPath === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(itemPath);
  };

  const baseLinkClasses = "flex items-center px-4 py-2.5 rounded-md mx-2 transition-colors duration-200";
  const activeLinkClasses = "bg-muted text-primary font-semibold border-l-4 border-primary";
  const inactiveLinkClasses = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  const NavIcon = ({ icon, active }: { icon: React.ReactNode; active: boolean }) => (
    <span className={`flex-shrink-0 ${active ? 'text-primary' : ''}`}>
      {icon}
    </span>
  );

  return (
    <div
      className={`h-screen flex-col bg-sidebar-background text-sidebar-foreground fixed left-0 top-0 z-40 transition-all duration-300 border-r border-sidebar-border hidden md:flex ${
        collapsed ? 'w-16' : 'w-64'
        }`}
    >
      <div className="border-b border-sidebar-border">
        {!collapsed && (
          <div className="p-4 flex items-center justify-between">
            <img
              src={logo}
              alt="STRATO"
              className="h-12"
            />
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground"
            >
              <ArrowLeft size={16} />
            </button>
          </div>
        )}
        {collapsed && (
          <div className="p-4 flex flex-col items-center space-y-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground"
            >
              <ArrowRight size={16} />
            </button>
            <img
              src={icon}
              alt="STRATO"
              className="h-8"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto py-4">
        <nav className="flex-1" role="navigation" aria-label="Sidebar">
          <ul className="space-y-1">
            {navItems.map((item, index) => {
              const active = isActive(item.path);
              return (
                <li key={index}>
                  {collapsed ? (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.path}
                            className={`${baseLinkClasses} ${active ? activeLinkClasses : inactiveLinkClasses}`}
                          >
                            <NavIcon icon={item.icon} active={active} />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="bg-muted text-sm rounded-md">
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <Link
                      to={item.path}
                      className={`${baseLinkClasses} ${active ? activeLinkClasses : inactiveLinkClasses}`}
                    >
                      <NavIcon icon={item.icon} active={active} />
                      <span className={`ml-3 ${active ? 'font-semibold' : ''}`}>{item.label}</span>
                    </Link>
                  )}
                </li>
              )})}
          </ul>
        </nav>
      </div>
    </div>
  );
};

export default DashboardSidebar;