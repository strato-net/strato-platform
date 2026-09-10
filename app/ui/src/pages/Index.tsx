
import { useEffect } from 'react';
import Navbar from '../components/Navbar';
import Hero from '../components/home/Hero';
import SiteFooter from '../components/SiteFooter';

const Index = () => {
  useEffect(() => {
    document.title = "STRATO | Where Stability Meets Opportunity";
  }, []);


  return (
    <div className="min-h-screen relative bg-background">
      <Navbar />
      <Hero />
      
      <SiteFooter />
    </div>
  );
};

export default Index;
