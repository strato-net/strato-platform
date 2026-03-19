import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { LayoutDashboard, Wallet, Book, ArrowRightLeft, Send, Shield, X, Activity, BarChart3, Droplets, Download, Coins, UserPlus, Vault, CreditCard, HandCoins, ArrowDownToLine } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import STRATOLOGO from '@/assets/strato.png';
import STRATOLOGODARK from '@/assets/strato-dark.png';

interface MobileNavItem {
  icon: ReactNode;
  label: string;
  path: string;
  adminOnly?: boolean;
}

interface MobileNavCategory {
  label?: string;
  items: MobileNavItem[];
}

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const MobileSidebar = ({ isOpen, onClose }: MobileSidebarProps) => {
  const { isAdmin } = useUser();
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === 'dark' ? STRATOLOGODARK : STRATOLOGO;

  const navCategories: MobileNavCategory[] = [
    {
      items: [
        { icon: <LayoutDashboard size={20} />, label: 'Portfolio', path: '/dashboard' },
      ],
    },
    {
      label: 'TRADE',
      items: [
        { icon: <ArrowDownToLine size={20} />, label: 'Fund', path: '/dashboard/deposits' },
        { icon: <ArrowRightLeft size={20} />, label: 'Swap', path: '/dashboard/swap' },
        { icon: <Book size={20} />, label: 'Borrow', path: '/dashboard/borrow' },
        { icon: <Send size={20} />, label: 'Transfer', path: '/dashboard/transfer' },
        { icon: <Download size={20} />, label: 'Withdrawals', path: '/dashboard/withdrawals' },
      ],
    },
    {
      label: 'SPEND',
      items: [
        { icon: <CreditCard size={20} />, label: 'Card', path: '/dashboard/credit-card' },
      ],
    },
    {
      label: 'EARN',
      items: [
        { icon: <HandCoins size={20} />, label: 'Earn', path: '/dashboard/earn' },
      ],
    },
    {
      label: 'PRO',
      items: [
        { icon: <Vault size={20} />, label: 'Vault', path: '/dashboard/vault' },
        { icon: <Coins size={20} />, label: 'Rewards', path: '/dashboard/rewards' },
        { icon: <Activity size={20} />, label: 'Activity Feed', path: '/dashboard/activity' },
        { icon: <BarChart3 size={20} />, label: 'STRATO Stats', path: '/dashboard/stats' },
        { icon: <Droplets size={20} />, label: 'Advanced', path: '/dashboard/advanced' },
        { icon: <UserPlus size={20} />, label: 'My Referrals', path: '/dashboard/referrals' },
        { icon: <Shield size={20} />, label: 'Admin', path: '/dashboard/admin', adminOnly: true },
      ],
    },
  ];

  const isActive = (itemPath: string) => {
    if (itemPath === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(itemPath);
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      
      {/* Mobile Sidebar */}
      <div className={`fixed left-0 top-0 h-full w-64 bg-background text-foreground z-50 md:hidden transform transition-transform duration-300 ease-in-out border-r border-border ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="border-b border-border">
          <div className="p-4 flex items-center justify-between">
            <img 
              src={logo} 
              alt="STRATO" 
              className="h-12" 
            />
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-muted text-foreground"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-col flex-1 overflow-y-auto py-4">
          <nav className="flex-1">
            {navCategories.map((category, idx) => {
              const visibleItems = category.items.filter(item => !item.adminOnly || isAdmin);
              if (visibleItems.length === 0) return null;
              return (
                <div key={idx} className={idx > 0 ? 'mt-4' : ''}>
                  {category.label && (
                    <div className="px-4 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {category.label}
                    </div>
                  )}
                  <ul className="space-y-1">
                    {visibleItems.map((item, index) => {
                      const active = isActive(item.path);
                      return (
                        <li key={index}>
                          <Link
                            to={item.path}
                            onClick={onClose}
                            className={`flex items-center px-4 py-2.5 rounded-md mx-2 transition-colors duration-200 ${active
                              ? 'bg-muted text-primary font-semibold border-l-4 border-primary'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}
                          >
                            <span className={`flex-shrink-0 ${active ? 'text-primary' : ''}`}>{item.icon}</span>
                            <span className={`ml-3 ${active ? 'font-semibold' : ''}`}>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
        </div>
      </div>
    </>
  );
};

export default MobileSidebar;
