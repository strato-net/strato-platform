
import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import Navbar from '../components/Navbar';
import Hero from '../components/home/Hero';
import STRATOLOGODARK from '@/assets/strato-dark.png';

const Index = () => {
  const { setTheme } = useTheme();

  useEffect(() => {

    document.title = "STRATO | Where Stability Meets Opportunity";
    // Force light mode on landing page
    setTheme('light');
  }, [setTheme]);


  return (
    <div className="min-h-screen relative bg-background">
      <Navbar />
      <Hero />
      
      <footer className="bg-strato-dark text-white py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center mb-4">
                <img src={STRATOLOGODARK} alt="STRATO" className="h-10 mr-3" />
                <span className="sr-only">STRATO</span>
              </div>
              <p className="text-muted-foreground text-sm">
                Where Stability Meets Opportunity. Easily earn on vaulted gold, silver & crypto.
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-8 md:col-span-2">
              <div>
                {/* <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Resources</h3>
                <ul className="space-y-2">
                  <li><a href="#" className="text-muted-foreground hover:text-foreground">Litepaper</a></li>
                  <li><a href="#" className="text-muted-foreground hover:text-foreground">Documentation</a></li>
                  <li><a href="#" className="text-muted-foreground hover:text-foreground">FAQ</a></li>
                  <li><a href="#" className="text-muted-foreground hover:text-foreground">Security</a></li>
                </ul> */}
              </div>
              <div>
                {/* <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Connect</h3>
                <ul className="space-y-2">
                  <li><a href="https://x.com/STRATO_MERCATA" className="text-muted-foreground hover:text-foreground">Twitter</a></li>
                  <li><a href="https://discord.gg/z5jwzD6x" className="text-muted-foreground hover:text-foreground">Discord</a></li>
                  <li><a href="https://t.me/mercatamarket" className="text-muted-foreground hover:text-foreground">Telegram</a></li>
                  <li><a href="https://github.com/blockapps" className="text-muted-foreground hover:text-foreground">GitHub</a></li>
                </ul> */}
              </div>
            </div>
          </div>
          
          <div className="mt-12 pt-8 border-t border-border text-sm text-muted-foreground">
            <div className="flex flex-col md:flex-row justify-between">
              <p>&copy; {new Date().getFullYear()} BlockApps Inc. All rights reserved.</p>
              {/* <div className="flex space-x-6 mt-4 md:mt-0">
                <a href="#" className="hover:text-white">Terms of Service</a>
                <a href="#" className="hover:text-white">Privacy Policy</a>
                <a href="#" className="hover:text-white">Legal</a>
              </div> */}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
