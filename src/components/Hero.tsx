
import { ArrowRight } from 'lucide-react';

const Hero = () => {
  return (
    <div className="relative min-h-screen pt-16 overflow-hidden hex-bg">
      {/* Background gradient blobs */}
      <div className="absolute inset-0 overflow-hidden">
        <div 
          className="absolute w-3/4 h-3/4 top-1/2 right-0 transform -translate-y-1/2 opacity-80"
          style={{
            background: 'radial-gradient(circle, rgba(120,40,255,0.7) 0%, rgba(31,66,172,0.8) 50%, rgba(255,122,0,0.6) 100%)',
            filter: 'blur(120px)',
            animation: 'gradient-flow 10s ease infinite',
          }}
        />
      </div>
      
      {/* Hexagonal pattern overlay */}
      <div className="absolute inset-0 bg-hex-pattern opacity-10"></div>
      
      <div className="container mx-auto px-4 pt-20 sm:pt-32 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-20">
          <div className="w-full lg:w-1/2 text-center lg:text-left">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              <span className="gradient-text">Live On-chain</span>
            </h1>
            <p className="text-xl md:text-2xl mb-8 text-gray-700">
              The easiest way to trade, and stake vaulted real-world assets
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <a href="#marketplace" className="cta-button flex items-center justify-center">
                Launch Marketplace
              </a>
              <a href="#how-it-works" className="secondary-button flex items-center justify-center">
                How It Works <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </div>
            <div className="mt-10 hidden md:block">
              <div className="inline-flex items-center px-4 py-2 bg-green-50 border border-green-100 rounded-full">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2"></div>
                <span className="text-sm font-medium text-green-700">$24.5M assets secured</span>
              </div>
            </div>
          </div>
          
          <div className="w-full lg:w-1/2 flex justify-center lg:justify-end">
            <div className="relative w-full max-w-md animate-float">
              <div 
                className="absolute inset-0 bg-gradient-to-br from-strato-blue via-strato-purple to-strato-orange opacity-30 rounded-full blur-2xl"
              ></div>
              <div className="relative z-10">
                <svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                  <path 
                    d="M387.8,317.5c-46.9,80.7-151.4,108.3-232.1,61.4S47.4,227.5,94.3,146.8S245.7,38.5,326.4,85.4c16.9,9.8,32,22.4,44.7,37.1"
                    fill="url(#gradient)"
                    transform="rotate(5, 250, 250)"
                  />
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#7E57C2" />
                      <stop offset="50%" stopColor="#3C7DFF" />
                      <stop offset="100%" stopColor="#FF7A00" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Mobile TVL indicator */}
      <div className="mt-8 block md:hidden text-center">
        <div className="inline-flex items-center px-4 py-2 bg-green-50 border border-green-100 rounded-full">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2"></div>
          <span className="text-sm font-medium text-green-700">$24.5M assets secured</span>
        </div>
      </div>
    </div>
  );
};

export default Hero;
