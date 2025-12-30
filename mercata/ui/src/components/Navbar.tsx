import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useUser } from '@/context/UserContext';
import { useNetwork } from '@/context/NetworkContext';
import { ModeToggle } from './mode-toggle';
import STRATOLOGO from '@/assets/strato.png';
import STRATOLOGODARK from '@/assets/strato-dark.png';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isLoggedIn, logout, loading } = useUser();
  const { isTestnet } = useNetwork();
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === 'dark' ? STRATOLOGODARK : STRATOLOGO;

  const handleAuthClick = () => {
    // Don't do anything if still loading
    if (loading) return;
    
    if (isLoggedIn) {
      logout();
    } else {
      const theme = resolvedTheme || 'light';
      window.location.href = `/login?theme=${theme}`;
    }
  };

  // Simple spinner component
  const Spinner = () => (
    <div className="inline-block w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin"></div>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md shadow-sm">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Link to="/landing" className="flex-shrink-0">
              <img 
                src={logo} 
                alt="STRATO" 
                className="h-10" 
              />
            </Link>
            {isTestnet && (
              <span className="bg-orange-500 text-white px-3 py-1.5 rounded-md text-sm font-bold uppercase tracking-wide shadow-md">
                TESTNET
              </span>
            )}
          </div>
          <div className="hidden md:flex items-center space-x-4">
            <ModeToggle />
            {isLoggedIn && (
            <Link 
              to="/dashboard"
              className="bg-strato-blue text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-strato-blue/90 transition-colors"
            >
              Launch App
            </Link>
            )}
            <button 
              onClick={handleAuthClick}
              disabled={loading}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                loading 
                  ? 'opacity-75 cursor-not-allowed text-muted-foreground border border-border'
                  : isLoggedIn 
                    ? 'text-red-600 dark:text-red-400 border border-red-300 dark:border-red-400 hover:bg-red-50 dark:hover:bg-red-400/10' 
                    : 'text-strato-blue dark:text-strato-lightblue border border-strato-blue/30 dark:border-strato-lightblue/50 hover:bg-strato-blue/5 dark:hover:bg-strato-lightblue/10'
              }`}
            >
              {loading ? <Spinner /> : isLoggedIn ? 'Log Out' : 'Login'}
            </button>
          </div>
          <div className="flex md:hidden">
            <button
              type="button"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-foreground hover:text-strato-blue hover:bg-muted focus:outline-none focus:ring-2 focus:ring-inset focus:ring-strato-blue"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              {isMenuOpen ? (
                <svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-background shadow-lg">
            <div className="pt-4 pb-2 border-t border-border space-y-2">
              {isLoggedIn && (
                <Link 
                  to="/dashboard"
                  className="block text-center w-full bg-strato-blue text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-strato-blue/90 transition-colors"
                >
                  Launch App
                </Link>
              )}
              <button 
                onClick={handleAuthClick}
                disabled={loading}
                className={`block text-center w-full px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  loading 
                    ? 'opacity-75 cursor-not-allowed text-muted-foreground border border-border'
                    : isLoggedIn 
                      ? 'text-red-600 dark:text-red-400 border border-red-300 dark:border-red-400 hover:bg-red-50 dark:hover:bg-red-400/10' 
                      : 'text-strato-blue dark:text-strato-lightblue border border-strato-blue dark:border-strato-lightblue hover:bg-strato-blue/5 dark:hover:bg-strato-lightblue/10'
                }`}
              >
                {loading ? <Spinner /> : isLoggedIn ? 'Log Out' : 'Login'}
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
