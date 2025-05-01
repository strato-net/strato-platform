
import { ArrowRight, Wallet, Coins, BadgePercent, ChartBar } from 'lucide-react';

const HowItWorks = () => {
  const steps = [
    {
      id: 1,
      title: 'Deposit',
      description: 'Bridge crypto or buy vaulted metals with minimal fees',
      icon: <Wallet className="h-6 w-6" />,
      color: 'bg-blue-500'
    },
    {
      id: 2,
      title: 'Auto-Earn',
      description: 'Your assets automatically start earning CATA rewards',
      icon: <Coins className="h-6 w-6" />,
      color: 'bg-green-500'
    },
    {
      id: 3,
      title: 'Borrow',
      description: 'Get instant credit lines against your vaulted assets',
      icon: <BadgePercent className="h-6 w-6" />,
      color: 'bg-purple-500'
    },
    {
      id: 4,
      title: 'Diversify',
      description: 'Expand your portfolio with a variety of assets',
      icon: <ChartBar className="h-6 w-6" />,
      color: 'bg-orange-500'
    }
  ];

  return (
    <div id="how-it-works" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">How It Works</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            STRATO Mercata simplifies the process of earning on vaulted assets while maintaining security and transparency.
          </p>
        </div>
        
        {/* Desktop view - horizontal steps */}
        <div className="hidden md:block">
          <div className="flex justify-between items-start relative">
            {/* Progress bar */}
            <div className="absolute top-8 left-0 right-0 h-1 bg-gray-200 z-0">
              <div className="h-full bg-gradient-to-r from-blue-500 via-green-500 to-purple-500 w-3/4"></div>
            </div>
            
            {/* Steps */}
            {steps.map((step, index) => (
              <div key={step.id} className="relative z-10 flex flex-col items-center w-60">
                <div className={`flex items-center justify-center w-16 h-16 rounded-full ${step.color} text-white mb-4`}>
                  {step.icon}
                </div>
                <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                <p className="text-sm text-gray-600 text-center">{step.description}</p>
                
                {index < steps.length - 1 && (
                  <ArrowRight className="absolute top-8 -right-7 transform translate-x-1/2 text-gray-400 h-4 w-4" />
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Mobile view - vertical steps */}
        <div className="md:hidden">
          <div className="relative flex flex-col space-y-8">
            {/* Vertical progress line */}
            <div className="absolute top-0 left-8 bottom-0 w-1 bg-gray-200 z-0">
              <div className="h-3/4 bg-gradient-to-b from-blue-500 via-green-500 to-purple-500"></div>
            </div>
            
            {/* Steps */}
            {steps.map((step) => (
              <div key={step.id} className="relative z-10 flex items-start">
                <div className={`flex-shrink-0 flex items-center justify-center w-16 h-16 rounded-full ${step.color} text-white mr-4`}>
                  {step.icon}
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1">{step.title}</h3>
                  <p className="text-sm text-gray-600">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="mt-16 text-center">
          <a href="#marketplace" className="cta-button inline-flex items-center">
            Open Wallet & Start Earning <ArrowRight className="ml-2 h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
};

export default HowItWorks;
