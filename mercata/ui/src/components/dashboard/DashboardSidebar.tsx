import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wallet, Database, LogOut, ArrowLeft, ArrowRight, Book, ArrowRightLeft, Send, Shield, Activity, BarChart3, ChevronDown, ChevronRight, GraduationCap, Droplets, TrendingUp, ShieldCheck, AlertTriangle, Building2, Vault } from 'lucide-react';
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ 'Deposit': true, 'Borrow': true, 'Pools': true, 'Activity': true });
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

  const allNavItems: Array<{ icon: React.ReactNode; label: string; path?: string; items?: Array<{ icon: React.ReactNode; label: string; path: string }> }> = [
    {
      icon: <Wallet size={20} />,
      label: 'Deposit',
      items: [
        { icon: <Wallet size={20} />, label: 'Bridge', path: '/dashboard/deposits' },
        { icon: <Send size={20} />, label: 'Transfer', path: '/dashboard/transfer' },
      ]
    },
    {
      icon: <Book size={20} />,
      label: 'Borrow',
      items: [
        { icon: <Building2 size={20} />, label: 'Lending Pool', path: '/dashboard/borrow/lending' },
        { icon: <Vault size={20} />, label: 'CDP Vaults', path: '/dashboard/borrow/cdp' },
      ]
    },
    { icon: <ArrowRightLeft size={20} />, label: 'Swap', path: '/dashboard/swap' },
    {
      icon: <Database size={20} />,
      label: 'Pools',
      items: [
        { icon: <Droplets size={20} />, label: 'Lending Pools', path: '/dashboard/pools/lending' },
        { icon: <TrendingUp size={20} />, label: 'Swap Pools', path: '/dashboard/pools/swap' },
        { icon: <ShieldCheck size={20} />, label: 'Safety Module', path: '/dashboard/pools/safety' },
        { icon: <AlertTriangle size={20} />, label: 'Liquidations', path: '/dashboard/pools/liquidations' },
      ]
    },
    {
      icon: <Activity size={20} />,
      label: 'Activity',
      items: [
        { icon: <BarChart3 size={20} />, label: 'Mercata Stats', path: '/dashboard/stats' },
        { icon: <Activity size={20} />, label: 'Activity Feed', path: '/dashboard/activity' },
      ]
    },
    { icon: <Shield size={20} />, label: 'Admin', path: '/dashboard/admin' },
  ];

  const navItems = allNavItems.filter(item => {
    if (item.path === '/dashboard/admin') return isAdmin;
    return true;
  });

  const isActive = (itemPath: string) => {
    if (itemPath === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(itemPath);
  };

  const toggleGroup = (groupLabel: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
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
            <Link to="/dashboard" className="hover:opacity-80 transition-opacity">
              <img
                src={MERCATALOGO}
                alt="STRATO mercata"
                className="h-12"
              />
            </Link>
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
            <Link to="/dashboard" className="hover:opacity-80 transition-opacity">
              <img
                src={MERCATAICON}
                alt="STRATO mercata"
                className="h-8"
              />
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto py-4">
        <nav className="flex-1" role="navigation" aria-label="Sidebar">
          <ul className="space-y-1">
            {navItems.map((item, index) => {
              // Handle grouped items
              if (item.items && item.items.length > 0) {
                const isExpanded = expandedGroups[item.label];
                const hasActiveChild = item.items.some(child => isActive(child.path));

                return (
                  <li key={index}>
                    {collapsed ? (
                      // Collapsed state: show tooltip with group items
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className={`${baseLinkClasses} ${hasActiveChild ? activeLinkClasses : inactiveLinkClasses} w-full`}
                              onClick={() => toggleGroup(item.label)}
                            >
                              <NavIcon icon={item.icon} active={hasActiveChild} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="bg-muted text-sm rounded-md">
                            <div className="space-y-1">
                              <div className="font-semibold">{item.label}</div>
                              {item.items.map((child, childIndex) => (
                                <Link
                                  key={childIndex}
                                  to={child.path}
                                  className="block px-2 py-1 hover:bg-sidebar-accent rounded text-xs"
                                >
                                  {child.label}
                                </Link>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      // Expanded state: show group with collapsible items
                      <>
                        <button
                          onClick={() => toggleGroup(item.label)}
                          className={`${baseLinkClasses} ${hasActiveChild ? 'text-black font-semibold' : inactiveLinkClasses} w-full justify-between`}
                        >
                          <div className="flex items-center">
                            <NavIcon icon={item.icon} active={hasActiveChild} />
                            <span className={`ml-3 ${hasActiveChild ? 'font-semibold' : ''}`}>{item.label}</span>
                          </div>
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        {isExpanded && (
                          <ul className="ml-8 mt-1 space-y-1">
                            {item.items.map((child, childIndex) => {
                              const childActive = isActive(child.path);
                              return (
                                <li key={childIndex}>
                                  <Link
                                    to={child.path}
                                    className={`flex items-center px-4 py-2 rounded-md mx-2 transition-colors duration-200 ${
                                      childActive
                                        ? 'bg-muted text-black font-semibold'
                                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                                    }`}
                                  >
                                    <NavIcon icon={child.icon} active={childActive} />
                                    <span className={`ml-3 text-sm ${childActive ? 'font-semibold' : ''}`}>{child.label}</span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    )}
                  </li>
                );
              }

              // Handle regular items (non-grouped)
              const active = item.path ? isActive(item.path) : false;
              return (
                <li key={index}>
                  {collapsed ? (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.path!}
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
                      to={item.path!}
                      className={`${baseLinkClasses} ${active ? activeLinkClasses : inactiveLinkClasses}`}
                    >
                      <NavIcon icon={item.icon} active={active} />
                      <span className={`ml-3 ${active ? 'font-semibold' : ''}`}>{item.label}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* DeFi Learning CTA */}
        <div className="px-4 pb-4 mt-4">
          {collapsed ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://blockapps.net/defi-guide"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center p-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors duration-200"
                  >
                    <GraduationCap size={20} />
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-muted text-sm rounded-md">
                  Learn more about DeFi
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <a
              href="https://blockapps.net/defi-guide"
              target="_blank"
              rel="noopener noreferrer"
              className="block p-4 bg-gradient-to-br from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-primary-foreground rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <div className="flex items-center gap-3 mb-2">
                <GraduationCap size={20} />
                <span className="font-semibold">Learn DeFi</span>
              </div>
              <p className="text-xs opacity-90">
                New to DeFi? Learn the basics and get started with our comprehensive guide.
              </p>
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardSidebar;