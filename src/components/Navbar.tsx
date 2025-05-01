
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Circle, Wallet } from 'lucide-react';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white bg-opacity-80 backdrop-blur-md shadow-sm">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <a href="/" className="flex-shrink-0">
              <div className="flex items-center">
                <div className="w-10 h-10 relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-strato-blue to-strato-purple rounded-md"></div>
                  <div className="absolute inset-[2px] bg-white rounded-md flex items-center justify-center">
                    <Circle className="h-6 w-6 text-strato-blue" />
                  </div>
                </div>
                <span className="ml-2 text-xl font-bold text-strato-dark">STRATO<span className="text-strato-blue">mercata</span></span>
              </div>
            </a>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <a href="#marketplace" className="text-gray-700 hover:text-strato-blue px-3 py-2 rounded-md text-sm font-medium">
                  Marketplace
                </a>
                <a href="#resources" className="text-gray-700 hover:text-strato-blue px-3 py-2 rounded-md text-sm font-medium">
                  Resources
                </a>
                <a href="#about" className="text-gray-700 hover:text-strato-blue px-3 py-2 rounded-md text-sm font-medium">
                  About
                </a>
              </div>
            </div>
          </div>
          <div className="hidden md:block">
            <div className="ml-4 flex items-center md:ml-6">
              <a href="/login" className="text-strato-blue border border-strato-blue/30 hover:bg-strato-blue/5 px-4 py-2 rounded-full mr-3 text-sm font-medium">
                Login
              </a>
              <Button className="bg-strato-blue hover:bg-strato-blue/90 text-white rounded-full">
                <Wallet className="mr-2 h-4 w-4" /> Connect Wallet
              </Button>
            </div>
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
            <a href="#marketplace" className="text-gray-700 hover:text-strato-blue block px-3 py-2 rounded-md text-base font-medium">
              Marketplace
            </a>
            <a href="#resources" className="text-gray-700 hover:text-strato-blue block px-3 py-2 rounded-md text-base font-medium">
              Resources
            </a>
            <a href="#about" className="text-gray-700 hover:text-strato-blue block px-3 py-2 rounded-md text-base font-medium">
              About
            </a>
            <div className="pt-4 pb-2 border-t border-gray-200">
              <a href="/login" className="block text-center w-full text-strato-blue border border-strato-blue hover:bg-strato-blue/5 px-4 py-2 rounded-full mb-2">
                Login
              </a>
              <Button className="w-full bg-strato-blue hover:bg-strato-blue/90 text-white rounded-full">
                <Wallet className="mr-2 h-4 w-4" /> Connect Wallet
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
