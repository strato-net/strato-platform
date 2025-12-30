import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { LayoutDashboard, ArrowUpDown, Send, Landmark, ArrowLeftRight, Gift, Activity, Download, BarChart3, Droplets, Shield } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import STRATOLOGO from '@/assets/strato.png';
import STRATOLOGODARK from '@/assets/strato-dark.png';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Portfolio', path: '/dashboard' },
  { icon: ArrowUpDown, label: 'Deposit', path: '/dashboard/deposits' },
  { icon: Send, label: 'Transfer', path: '/dashboard/transfer' },
  { icon: Landmark, label: 'Borrow', path: '/dashboard/borrow' },
  { icon: ArrowLeftRight, label: 'Swap', path: '/dashboard/swap' },
  { icon: Gift, label: 'Rewards', path: '/dashboard/rewards' },
  { icon: Activity, label: 'Activity', path: '/dashboard/activity' },
  { icon: Download, label: 'Withdraw', path: '/dashboard/withdrawals' },
  { icon: BarChart3, label: 'Mercata Stats', path: '/dashboard/stats' },
  { icon: Droplets, label: 'Advanced', path: '/dashboard/advanced' },
  { icon: Shield, label: 'Admin', path: '/dashboard/admin', adminOnly: true },
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

  const isActive = (path: string) => 
    path === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(path);

  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-[250px] bg-sidebar-background border-r border-sidebar-border z-40">
      <div className="p-5 border-b border-sidebar-border">
        <img src={resolvedTheme === 'dark' ? STRATOLOGODARK : STRATOLOGO} alt="STRATO" className="h-10" />
      </div>

      <nav className="flex-1 py-4 px-4 overflow-y-auto">
        <ul className="space-y-1">
          {NAV_ITEMS.filter(item => !item.adminOnly || isAdmin).map(({ icon: Icon, label, path }) => (
            <li key={path}>
              <Link
                to={path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
                  isActive(path)
                    ? 'bg-blue-50/80 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium border-l-4 border-blue-500'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <Icon size={20} />
                <span className="text-sm">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

export default DashboardSidebar;
