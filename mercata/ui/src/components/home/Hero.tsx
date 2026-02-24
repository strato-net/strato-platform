import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
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
import { useUser } from '@/context/UserContext';
import heroBackground from '../../assets/home/hero-background.png';
import darkThemeBackground from '../../assets/home/darktheme-hero-bg.png';

const Hero = () => {
  const { resolvedTheme } = useTheme();
  const { isLoggedIn } = useUser();
  const navigate = useNavigate();
  const backgroundImage = resolvedTheme === 'dark' ? darkThemeBackground : heroBackground;

  const handleGetStarted = () => {
    if (isLoggedIn) {
      navigate('/dashboard');
    } else {
      const theme = localStorage.getItem('theme') || 'light';
      window.location.href = `/login?theme=${theme}`;
    }
  };

  return (
    <>
      {/* Hero Section */}
      <section className="overflow-hidden">
        <div className="relative">
          <div className="relative overflow-hidden min-h-[500px] md:min-h-[calc(100vh-100px)]">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center md:bg-right bg-no-repeat"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover'
        }}
      />
            
            <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-12 md:py-16 lg:py-20 min-h-[500px] md:min-h-[calc(100vh-100px)] flex flex-col justify-center">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-white dark:bg-slate-800 rounded-full px-4 py-2 shadow-sm border border-border/50 w-fit mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <Sparkles className="w-4 h-4 text-strato-lightblue" />
                <span className="text-sm font-medium text-foreground">Welcome to STRATO</span>
              </div>
              
              {/* Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
                <span className="text-foreground">Where Stability</span>
                <br />
                <span className="text-strato-lightblue">Meets</span>
                <br />
                <span className="text-strato-lightblue">Opportunity</span>
              </h1>
              
              {/* Description */}
              <p className="text-lg text-muted-foreground mb-8 max-w-md leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
            Diverse asset classes, one platform. From crypto to precious metals to tokenized securities—investing made simple for everyone.
          </p>
              
              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
            <button
              onClick={handleGetStarted}
                  className="group inline-flex items-center justify-center gap-2 bg-strato-lightblue hover:bg-strato-blue text-white px-6 py-3 rounded-lg font-medium transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  Get Started
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                </button>
                <Link
                  to="/dashboard/rewards"
                  className="inline-flex items-center justify-center gap-2 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-foreground px-6 py-3 rounded-lg font-medium border border-border transition-all duration-300"
                >
                  Earn Rewards
            </Link>
          </div>
        </div>
      </div>
    </div>
      </section>

      {/* Trust Indicators */}
      <section className="pb-4 lg:pb-6">
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
      <section className="pt-2 pb-4 lg:py-6">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="mb-6 lg:mb-8">
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
      <section className="pt-2 pb-4 lg:py-6">
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
    </>
  );
};

export default Hero;
