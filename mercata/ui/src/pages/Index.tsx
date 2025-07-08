
import { useEffect } from 'react';
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import FeaturedAssets from '../components/FeaturedAssets';
import HowItWorks from '../components/HowItWorks';
import FAQ from '../components/FAQ';
import MERCATALOGO from '@/assets/mercata.png';

const Index = () => {
  useEffect(() => {
    document.title = "STRATO Mercata | Where Stability Meets Opportunity";
  }, []);

  return (
    <div className="min-h-screen relative bg-white">
      <Navbar />
      <Hero />
      <FeaturedAssets />
      <HowItWorks />
      <FAQ />
      
      <footer className="bg-strato-dark text-white py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center mb-4">
                <img src={MERCATALOGO} alt="STRATO Mercata" className="h-10 mr-3" />
                <span className="sr-only">STRATO Mercata</span>
              </div>
              <p className="text-gray-400 text-sm">
                Where Stability Meets Opportunity. Easily earn on vaulted gold, silver & crypto.
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-8 md:col-span-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Resources</h3>
                <ul className="space-y-2">
                  <li><a href="#" className="text-gray-400 hover:text-white">Litepaper</a></li>
                  <li><a href="#" className="text-gray-400 hover:text-white">Documentation</a></li>
                  <li><a href="#" className="text-gray-400 hover:text-white">FAQ</a></li>
                  <li><a href="#" className="text-gray-400 hover:text-white">Security</a></li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Connect</h3>
                <ul className="space-y-2">
                  <li><a href="#" className="text-gray-400 hover:text-white">Twitter</a></li>
                  <li><a href="#" className="text-gray-400 hover:text-white">Discord</a></li>
                  <li><a href="#" className="text-gray-400 hover:text-white">Medium</a></li>
                  <li><a href="#" className="text-gray-400 hover:text-white">GitHub</a></li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="mt-12 pt-8 border-t border-gray-800 text-sm text-gray-400">
            <div className="flex flex-col md:flex-row justify-between">
              <p>&copy; 2025 BlockApps Inc. All rights reserved.</p>
              <div className="flex space-x-6 mt-4 md:mt-0">
                <a href="#" className="hover:text-white">Terms of Service</a>
                <a href="#" className="hover:text-white">Privacy Policy</a>
                <a href="#" className="hover:text-white">Legal</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
