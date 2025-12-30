import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowRight, 
  Shield, 
  Zap, 
  TrendingUp, 
  PiggyBank, 
  FileText, 
  Gift,
  Sparkles
} from 'lucide-react';
import Navbar from '../components/Navbar';
import STRATOLOGODARK from '@/assets/strato-dark.png';

const LandingPage = () => {
  useEffect(() => {
    document.title = "STRATO | Where Stability Meets Opportunity";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero Section */}
      <section className="pt-20 lg:pt-24 overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative bg-gradient-to-br from-amber-50 via-orange-50/50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 rounded-3xl overflow-hidden">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-0">
              {/* Left Content */}
              <div className="relative z-10 p-8 sm:p-12 lg:p-16 flex flex-col justify-center">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 bg-white dark:bg-slate-800 rounded-full px-4 py-2 shadow-sm border border-border/50 w-fit mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <Sparkles className="w-4 h-4 text-strato-lightblue" />
                  <span className="text-sm font-medium text-foreground">Welcome to STRATO</span>
                </div>
                
                {/* Headline */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                  <span className="text-foreground">Where Stability</span>
                  <br />
                  <span className="text-strato-lightblue">Meets Opportunity</span>
                </h1>
                
                {/* Description */}
                <p className="text-lg text-muted-foreground mb-8 max-w-md leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
                  Diverse asset classes, one platform. From crypto to precious metals to tokenized securities—investing made simple for everyone.
                </p>
                
                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
                  <Link
                    to="/dashboard"
                    className="group inline-flex items-center justify-center gap-2 bg-strato-lightblue hover:bg-strato-blue text-white px-6 py-3 rounded-lg font-medium transition-all duration-300 shadow-lg hover:shadow-xl"
                  >
                    Get Started
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </Link>
                  <Link
                    to="/dashboard/stats"
                    className="inline-flex items-center justify-center gap-2 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-foreground px-6 py-3 rounded-lg font-medium border border-border transition-all duration-300"
                  >
                    Explore Stats
                  </Link>
                </div>
              </div>
              
              {/* Right - Geometric Shapes */}
              <div className="relative hidden lg:block min-h-[400px] lg:min-h-[500px]">
                {/* Blue gradient background */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 via-blue-500/30 to-blue-600/20 dark:from-blue-600/10 dark:via-blue-500/20 dark:to-blue-400/10" />
                
                {/* Geometric shapes */}
                <div className="absolute inset-0 overflow-hidden">
                  {/* Large orange square - top right */}
                  <div 
                    className="absolute top-8 right-12 w-32 h-32 bg-gradient-to-br from-orange-400 to-orange-500 rounded-lg shadow-2xl transform rotate-12 animate-float"
                    style={{ animationDelay: '0s' }}
                  />
                  
                  {/* Medium coral square - center right */}
                  <div 
                    className="absolute top-24 right-48 w-24 h-24 bg-gradient-to-br from-orange-300 to-orange-400 rounded-lg shadow-xl transform -rotate-6 animate-float"
                    style={{ animationDelay: '1s' }}
                  />
                  
                  {/* Small orange square - bottom */}
                  <div 
                    className="absolute bottom-32 right-24 w-28 h-28 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg shadow-xl transform rotate-45 animate-float"
                    style={{ animationDelay: '2s' }}
                  />
                  
                  {/* Blue triangle - center */}
                  <div 
                    className="absolute top-1/2 left-1/4 transform -translate-y-1/2"
                    style={{ animationDelay: '0.5s' }}
                  >
                    <div className="w-0 h-0 border-l-[40px] border-l-transparent border-r-[40px] border-r-transparent border-b-[70px] border-b-blue-500 dark:border-b-blue-400 transform rotate-12 animate-float" />
                  </div>
                  
                  {/* Small blue triangle */}
                  <div 
                    className="absolute bottom-24 left-1/3 animate-float"
                    style={{ animationDelay: '1.5s' }}
                  >
                    <div className="w-0 h-0 border-l-[25px] border-l-transparent border-r-[25px] border-r-transparent border-b-[45px] border-b-blue-400 dark:border-b-blue-300 transform -rotate-6" />
                  </div>
                  
                  {/* Diamond shape */}
                  <div 
                    className="absolute top-40 left-1/2 w-12 h-12 bg-gradient-to-br from-slate-700 to-slate-800 dark:from-slate-500 dark:to-slate-600 rounded-sm transform rotate-45 shadow-lg animate-float"
                    style={{ animationDelay: '2.5s' }}
                  />
                  
                  {/* Decorative lines */}
                  <div className="absolute top-1/3 right-0 w-48 h-px bg-gradient-to-l from-white/40 to-transparent" />
                  <div className="absolute bottom-1/3 left-1/4 w-32 h-px bg-gradient-to-r from-white/30 to-transparent" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Indicators */}
      <section className="py-8 lg:py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
            {/* Secure & Audited */}
            <div className="flex items-center gap-4 p-6 bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-lg bg-muted">
                <Shield className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Secure & Audited</h3>
                <p className="text-sm text-muted-foreground">Enterprise-grade security with audited smart contracts</p>
              </div>
            </div>
            
            {/* Lightning Fast */}
            <div className="flex items-center gap-4 p-6 bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-lg bg-muted">
                <Zap className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Lightning Fast</h3>
                <p className="text-sm text-muted-foreground">Near-instant transactions with minimal gas fees</p>
              </div>
            </div>
            
            {/* Competitive Yields */}
            <div className="flex items-center gap-4 p-6 bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-lg bg-muted">
                <TrendingUp className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Competitive Yields</h3>
                <p className="text-sm text-muted-foreground">Earn attractive returns on your deposited assets</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 lg:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="mb-10 lg:mb-12">
            <h2 className="text-2xl lg:text-3xl font-bold text-foreground mb-2">Explore Features</h2>
            <p className="text-muted-foreground">Everything you need to manage your digital assets</p>
          </div>
          
          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Easy Savings */}
            <div className="group p-6 lg:p-8 bg-card rounded-2xl border border-border shadow-sm hover:shadow-lg hover:border-strato-lightblue/30 transition-all duration-300">
              <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20 mb-6 group-hover:scale-110 transition-transform duration-300">
                <PiggyBank className="w-6 h-6 text-strato-lightblue" />
              </div>
              <span className="text-sm font-medium text-strato-lightblue">Grow your wealth</span>
              <h3 className="text-xl font-bold text-foreground mt-1 mb-3">Easy Savings</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Deposit your assets and watch them grow. Earn competitive yields automatically with our simple savings solution.
              </p>
              <Link 
                to="/dashboard/deposits"
                className="inline-flex items-center gap-2 text-strato-lightblue font-medium hover:gap-3 transition-all duration-300"
              >
                Start Saving
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            
            {/* Borrow */}
            <div className="group p-6 lg:p-8 bg-card rounded-2xl border border-border shadow-sm hover:shadow-lg hover:border-strato-lightblue/30 transition-all duration-300">
              <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20 mb-6 group-hover:scale-110 transition-transform duration-300">
                <FileText className="w-6 h-6 text-strato-lightblue" />
              </div>
              <span className="text-sm font-medium text-strato-lightblue">Unlock liquidity</span>
              <h3 className="text-xl font-bold text-foreground mt-1 mb-3">Borrow</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Use your deposits as collateral to borrow USDST instantly. Flexible terms, competitive rates, no credit checks.
              </p>
              <Link 
                to="/dashboard/borrow"
                className="inline-flex items-center gap-2 text-strato-lightblue font-medium hover:gap-3 transition-all duration-300"
              >
                Borrow Now
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            
            {/* Rewards */}
            <div className="group p-6 lg:p-8 bg-card rounded-2xl border border-border shadow-sm hover:shadow-lg hover:border-strato-lightblue/30 transition-all duration-300">
              <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20 mb-6 group-hover:scale-110 transition-transform duration-300">
                <Gift className="w-6 h-6 text-strato-lightblue" />
              </div>
              <span className="text-sm font-medium text-strato-lightblue">Earn as you go</span>
              <h3 className="text-xl font-bold text-foreground mt-1 mb-3">Rewards</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Get rewarded for every action you take. Climb the leaderboard, unlock achievements, and maximize your earnings.
              </p>
              <Link 
                to="/dashboard/rewards"
                className="inline-flex items-center gap-2 text-strato-lightblue font-medium hover:gap-3 transition-all duration-300"
              >
                View Rewards
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA Section */}
      <section className="py-8 lg:py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-card rounded-2xl border border-border p-6 lg:p-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h3 className="text-xl lg:text-2xl font-bold text-foreground mb-2">Ready to dive deeper?</h3>
                <p className="text-muted-foreground">Access advanced features like liquidity pools, safety modules, and more.</p>
              </div>
              <Link
                to="/dashboard/advanced"
                className="group flex-shrink-0 inline-flex items-center justify-center gap-2 bg-strato-lightblue hover:bg-strato-blue text-white px-6 py-3 rounded-lg font-medium transition-all duration-300 shadow-lg hover:shadow-xl"
              >
                Advanced Features
                <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
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
                {/* Placeholder for future links */}
              </div>
              <div>
                {/* Placeholder for future links */}
              </div>
            </div>
          </div>
          
          <div className="mt-12 pt-8 border-t border-border text-sm text-muted-foreground">
            <div className="flex flex-col md:flex-row justify-between">
              <p>&copy; {new Date().getFullYear()} BlockApps Inc. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

