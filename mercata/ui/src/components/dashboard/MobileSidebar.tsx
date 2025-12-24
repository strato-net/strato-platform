import { Link, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { LayoutDashboard, Gift, Activity, Download, BarChart3, Settings, Shield, X } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import STRATOLOGO from '@/assets/strato.png';
import STRATOLOGODARK from '@/assets/strato-dark.png';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Portfolio', path: '/dashboard' },
  { icon: Gift, label: 'Rewards', path: '/dashboard/rewards' },
  { icon: Activity, label: 'Activity', path: '/dashboard/activity' },
  { icon: Download, label: 'Withdraw', path: '/dashboard/withdrawals' },
  { icon: BarChart3, label: 'Mercata Stats', path: '/dashboard/stats' },
  { icon: Settings, label: 'Advanced', path: '/dashboard/advanced' },
  { icon: Shield, label: 'Admin', path: '/dashboard/admin', adminOnly: true },
];

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const MobileSidebar = ({ isOpen, onClose }: MobileSidebarProps) => {
  const { isAdmin } = useUser();
  const { pathname } = useLocation();
  const { resolvedTheme } = useTheme();

  const isActive = (path: string) => 
    path === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(path);

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      
      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 h-full w-64 bg-background z-50 md:hidden transform transition-transform border-r border-border ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-4 flex items-center justify-between border-b border-border">
          <img src={resolvedTheme === 'dark' ? STRATOLOGODARK : STRATOLOGO} alt="STRATO" className="h-10" />
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X size={20} />
          </button>
        </div>

        <nav className="py-4 overflow-y-auto">
          <ul className="space-y-2 px-3">
            {NAV_ITEMS.filter(item => !item.adminOnly || isAdmin).map(({ icon: Icon, label, path }) => (
              <li key={path}>
                <Link
                  to={path}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive(path)
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
};

export default MobileSidebar;
