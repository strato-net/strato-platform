import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wallet, Database, LogOut, ArrowLeft, ArrowRight, Book, ArrowRightLeft, Send, Shield, Activity, Gift } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import MERCATALOGO from '@/assets/mercata.png';
import MERCATAICON from '@/assets/icon.png';
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
    { icon: <Book size={20} />, label: 'Borrow', path: '/dashboard/borrow' },
    { icon: <ArrowRightLeft size={20} />, label: 'Swap', path: '/dashboard/swap' },
    { icon: <Database size={20} />, label: 'Pools', path: '/dashboard/pools' },
    // { icon: <Gift size={20} />, label: 'Rewards', path: '/dashboard/rewards' },
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
  const activeLinkClasses = "bg-muted text-black font-semibold border-l-4 border-primary";
  const inactiveLinkClasses = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  const NavIcon = ({ icon, active }: { icon: React.ReactNode; active: boolean }) => (
    <span className={`flex-shrink-0 ${active ? 'text-black' : ''}`}>
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
              src={MERCATALOGO}
              alt="STRATO mercata"
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
              src={MERCATAICON}
              alt="STRATO mercata"
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