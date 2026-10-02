import { DEFAULT_TITLE, usePageTitle } from "@/hooks/usePageTitle";
import Navbar from '../components/Navbar';
import Hero from '../components/home/Hero';
import SiteFooter from '../components/SiteFooter';

const Index = () => {
  // The home page is the brand tagline itself, not a "<Page> | STRATO" title.
  usePageTitle(DEFAULT_TITLE);

  return (
    <div className="min-h-screen relative bg-background">
      <Navbar />
      <Hero />
      
      <SiteFooter />
    </div>
  );
};

export default Index;
