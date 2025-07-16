import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@/context/UserContext';
import MERCATALOGO from '@/assets/mercata.png';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isLoggedIn, logout, loading } = useUser();

  const handleAuthClick = () => {
    // Don't do anything if still loading
    if (loading) return;
    
    if (isLoggedIn) {
      logout();
    } else {
      window.location.href = '/login';
    }
  };

  // Simple spinner component
  const Spinner = () => (
    <div className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white bg-opacity-80 backdrop-blur-md shadow-sm">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0">
              <img 
                src={MERCATALOGO} 
                alt="STRATO mercata" 
                className="h-10" 
              />
            </Link>
          </div>
          <div className="hidden md:flex items-center space-x-4">
            {isLoggedIn && (
              <Link 
                to="/dashboard"
                className="bg-strato-blue text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-strato-blue/90 transition-colors"
              >
                Launch STRATO
              </Link>
            )}
            <button 
              onClick={handleAuthClick}
              disabled={loading}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                loading 
                  ? 'opacity-75 cursor-not-allowed text-gray-500 border border-gray-300'
                  : isLoggedIn 
                    ? 'text-red-600 border border-red-300 hover:bg-red-50' 
                    : 'text-strato-blue border border-strato-blue/30 hover:bg-strato-blue/5'
              }`}
            >
              {loading ? <Spinner /> : isLoggedIn ? 'Log Out' : 'Login'}
            </button>
          </div>
          <div className="flex md:hidden">
            <button
              type="button"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-strato-blue hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-strato-blue"
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
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white shadow-lg">
            <div className="pt-4 pb-2 border-t border-gray-200 space-y-2">
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
                    ? 'opacity-75 cursor-not-allowed text-gray-500 border border-gray-300'
                    : isLoggedIn 
                      ? 'text-red-600 border border-red-300 hover:bg-red-50' 
                      : 'text-strato-blue border border-strato-blue hover:bg-strato-blue/5'
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
