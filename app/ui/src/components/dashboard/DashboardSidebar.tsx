import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  LayoutDashboard,
  ArrowUpDown,
  Send,
  Landmark,
  ArrowLeftRight,
  Gift,
  Activity,
  Download,
  BarChart3,
  Droplets,
  Shield,
  SlidersHorizontal,
  LucideIcon,
  HandCoins,
  Layers,
  ArrowDownToLine,
  Compass,
  CandlestickChart,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { useUser } from '@/context/UserContext';
import STRATOLOGO from '@/assets/strato.png';
import STRATOLOGODARK from '@/assets/strato-dark.png';
import STRATOICON from '@/assets/icon.png';
import STRATOICONDARK from '@/assets/dark-theme-strato-compressed-logo.png';

const COLLAPSED_KEY = 'sidebar-collapsed';
const EXPANDED_WIDTH = 250;
const COLLAPSED_WIDTH = 72;

interface NavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  adminOnly?: boolean;
  badge?: string;
}

interface NavCategory {
  label?: string;
  items: NavItem[];
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    items: [
      { icon: LayoutDashboard, label: 'Portfolio', path: '/dashboard' },
      { icon: Compass, label: 'Explore', path: '/dashboard/explore' },
    ],
  },
  {
    label: 'TRADE',
    items: [
      { icon: ArrowDownToLine, label: 'Fund', path: '/dashboard/deposits' },
      { icon: ArrowLeftRight, label: 'Trade', path: '/dashboard/swap' },
      { icon: CandlestickChart, label: 'Terminal', path: '/dashboard/terminal', badge: 'New' },
      { icon: Landmark, label: 'Borrow', path: '/dashboard/borrow' },
      { icon: Send, label: 'Send', path: '/dashboard/transfer' },
      { icon: Download, label: 'Bridge Out', path: '/dashboard/withdrawals' },
    ],
  },
  {
    label: 'EARN',
    items: [
      { icon: HandCoins, label: 'Earn', path: '/dashboard/earn' },
      { icon: Layers, label: 'Stake', path: '/dashboard/earn-staking' },
      { icon: Gift, label: 'Rewards', path: '/dashboard/rewards' },
    ],
  },
  {
    label: 'PRO',
    items: [
      { icon: SlidersHorizontal, label: 'Advanced', path: '/dashboard/advanced' },
      { icon: Droplets, label: 'V3 Liquidity', path: '/dashboard/v3-liquidity' },
      { icon: Activity, label: 'Activity Feed', path: '/dashboard/activity' },
      { icon: BarChart3, label: 'Analytics', path: '/dashboard/stats' },
      { icon: Shield, label: 'Admin', path: '/dashboard/admin', adminOnly: true },
    ],
  },
];

const DashboardSidebar = () => {
  const { isAdmin } = useUser();
  const { pathname } = useLocation();
  const { resolvedTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  useEffect(() => {
    const updateWidth = () => {
      document.documentElement.style.setProperty(
        '--sidebar-width',
        window.innerWidth >= 768 ? `${width}px` : '0px'
      );
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [width]);

  const toggleCollapsed = () => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1');
    setCollapsed(!collapsed);
  };

  const isActive = (path: string) => {
    if (path === '/dashboard') return pathname === '/dashboard';
    // Stake (/dashboard/earn-staking) has its own nav item, so Earn must not match it
    if (path === '/dashboard/earn') return pathname.startsWith(path) && !pathname.startsWith('/dashboard/earn-staking');
    return pathname.startsWith(path);
  };

  const renderNavItem = ({ icon: Icon, label, path, badge }: NavItem) => {
    const active = isActive(path);
    return (
      <li key={path}>
        <Link
          to={path}
          title={collapsed ? label : undefined}
          className={`relative flex items-center gap-3 py-2.5 rounded-lg transition-colors ${collapsed ? 'justify-center' : 'px-4'} ${active
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }`}
        >
          {/* Left border accent for active state */}
          {active && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r-full" />
          )}
          <Icon size={20} />
          {!collapsed && <span className="text-sm">{label}</span>}
          {badge && !collapsed && (
            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
              {badge}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 h-screen bg-sidebar-background border-r border-sidebar-border z-40 transition-[width] duration-300"
      style={{ width }}
    >
      {/* Logo */}
      <div className={`h-20 flex items-center border-b border-sidebar-border ${collapsed ? 'justify-center' : 'px-5'}`}>
        {collapsed ? (
          <img src={resolvedTheme === 'dark' ? STRATOICONDARK : STRATOICON} alt="STRATO" className="h-9" />
        ) : (
          <img src={resolvedTheme === 'dark' ? STRATOLOGODARK : STRATOLOGO} alt="STRATO" className="h-10" />
        )}
      </div>

      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        {NAV_CATEGORIES.map((category, idx) => {
          const visibleItems = category.items.filter(item => !item.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;
          return (
            <div key={idx} className={idx > 0 ? 'mt-4' : ''}>
              {category.label && (collapsed ? (
                <div className="mx-3 mb-3 border-t border-sidebar-border" />
              ) : (
                <div className="px-4 py-1.5 text-[11px] font-semibold tracking-wider text-gray-400 dark:text-gray-500 uppercase">
                  {category.label}
                </div>
              ))}
              <ul className="space-y-1">
                {visibleItems.map(renderNavItem)}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : undefined}
          className={`w-full flex items-center gap-3 py-2.5 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${collapsed ? 'justify-center' : 'px-4'}`}
        >
          {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          {!collapsed && <span className="text-sm">Collapse</span>}
        </button>
      </div>
    </aside>
  );
};

export default DashboardSidebar;
