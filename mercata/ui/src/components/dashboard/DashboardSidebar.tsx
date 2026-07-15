import { useEffect } from 'react';
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
  LucideIcon,
  HandCoins,
  Layers,
  ArrowDownToLine
} from 'lucide-react';
import { useUser } from '@/context/UserContext';
import STRATOLOGO from '@/assets/strato.png';
import STRATOLOGODARK from '@/assets/strato-dark.png';

interface NavItem {
  icon: LucideIcon;
  label: string;
  path: string;
  adminOnly?: boolean;
}

interface NavCategory {
  label?: string;
  items: NavItem[];
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    items: [
      { icon: LayoutDashboard, label: 'Portfolio', path: '/dashboard' },
    ],
  },
  {
    label: 'TRADE',
    items: [
      { icon: ArrowDownToLine, label: 'Fund', path: '/dashboard/deposits' },
      { icon: ArrowLeftRight, label: 'Trade', path: '/dashboard/swap' },
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
      { icon: Droplets, label: 'Advanced', path: '/dashboard/advanced' },
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

  useEffect(() => {
    const updateWidth = () => {
      document.documentElement.style.setProperty(
        '--sidebar-width',
        window.innerWidth >= 768 ? '250px' : '0px'
      );
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const isActive = (path: string) => {
    if (path === '/dashboard') return pathname === '/dashboard';
    // Stake (/dashboard/earn-staking) has its own nav item, so Earn must not match it
    if (path === '/dashboard/earn') return pathname.startsWith(path) && !pathname.startsWith('/dashboard/earn-staking');
    return pathname.startsWith(path);
  };

  const renderNavItem = ({ icon: Icon, label, path }: NavItem) => {
    const active = isActive(path);
    return (
      <li key={path}>
        <Link
          to={path}
          className={`relative flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${active
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50'
            }`}
        >
          {/* Left border accent for active state */}
          {active && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r-full" />
          )}
          <Icon size={20} />
          <span className="text-sm">{label}</span>
        </Link>
      </li>
    );
  };

  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-[250px] bg-sidebar-background border-r border-sidebar-border z-40">
      {/* Logo */}
      <div className="p-5 border-b border-sidebar-border">
        <img src={resolvedTheme === 'dark' ? STRATOLOGODARK : STRATOLOGO} alt="STRATO" className="h-10" />
      </div>

      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        {NAV_CATEGORIES.map((category, idx) => {
          const visibleItems = category.items.filter(item => !item.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;
          return (
            <div key={idx} className={idx > 0 ? 'mt-4' : ''}>
              {category.label && (
                <div className="px-4 py-1.5 text-[11px] font-semibold tracking-wider text-gray-400 dark:text-gray-500 uppercase">
                  {category.label}
                </div>
              )}
              <ul className="space-y-1">
                {visibleItems.map(renderNavItem)}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

export default DashboardSidebar;
