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
  UserPlus,
  ChevronUp,
  ChevronDown,
  LucideIcon,
  Vault,
  CreditCard
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

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Portfolio', path: '/dashboard' },
  { icon: ArrowUpDown, label: 'Deposit', path: '/dashboard/deposits' },
  { icon: Send, label: 'Transfer', path: '/dashboard/transfer' },
  { icon: Landmark, label: 'Borrow', path: '/dashboard/borrow' },
  { icon: ArrowLeftRight, label: 'Swap', path: '/dashboard/swap' },
  { icon: Vault, label: 'Vault', path: '/dashboard/vault' },
  { icon: Gift, label: 'Rewards', path: '/dashboard/rewards' },
];

const MORE_NAV_ITEMS: NavItem[] = [
  { icon: Activity, label: 'Activity Feed', path: '/dashboard/activity' },
  { icon: CreditCard, label: 'Crypto Credit Card', path: '/dashboard/credit-card' },
  { icon: Download, label: 'Withdrawals', path: '/dashboard/withdrawals' },
  { icon: BarChart3, label: 'STRATO Stats', path: '/dashboard/stats' },
  { icon: Droplets, label: 'Advanced', path: '/dashboard/advanced' },
  { icon: UserPlus, label: 'My Referrals', path: '/dashboard/referrals' },
  { icon: Shield, label: 'Admin', path: '/dashboard/admin', adminOnly: true },
];

const DashboardSidebar = () => {
  const { isAdmin } = useUser();
  const { pathname } = useLocation();
  const { resolvedTheme } = useTheme();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

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

  // Auto-expand "More" if any of its items is active
  useEffect(() => {
    const isMoreItemActive = MORE_NAV_ITEMS
      .filter(item => !item.adminOnly || isAdmin)
      .some(item => 
        item.path === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.path)
      );
    if (isMoreItemActive) {
      setIsMoreOpen(true);
    }
  }, [pathname, isAdmin]);

  const isActive = (path: string) => 
    path === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(path);

  const renderNavItem = ({ icon: Icon, label, path }: NavItem) => {
    const active = isActive(path);
    return (
      <li key={path}>
        <Link
          to={path}
          className={`relative flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
            active
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
        {/* Primary Navigation */}
        <ul className="space-y-1">
          {PRIMARY_NAV_ITEMS.map(renderNavItem)}
        </ul>

        {/* More Section */}
        <div className="mt-4">
          <button
            onClick={() => setIsMoreOpen(!isMoreOpen)}
            className="flex items-center justify-between w-full px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors"
          >
            <span>More</span>
            {isMoreOpen ? (
              <ChevronUp size={18} className="text-gray-400" />
            ) : (
              <ChevronDown size={18} className="text-gray-400" />
            )}
          </button>
          
          {isMoreOpen && (
            <ul className="mt-1 space-y-1">
              {MORE_NAV_ITEMS
                .filter(item => !item.adminOnly || isAdmin)
                .map(renderNavItem)}
            </ul>
          )}
        </div>
      </nav>
    </aside>
  );
};

export default DashboardSidebar;
