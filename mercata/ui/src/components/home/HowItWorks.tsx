import { Wallet, TrendingUp, DollarSign, Shield } from 'lucide-react';

const HowItWorks = () => {
  const steps = [
    {
      icon: <Wallet className="h-8 w-8" />,
      title: "Connect & Deposit",
      description: "Signup and deposit gold, silver, or crypto assets into our secure vaults and pools.",
      step: "01",
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100",
      iconBg: "bg-blue-500/10",
      iconColor: "text-blue-600"
    },
    {
      icon: <TrendingUp className="h-8 w-8" />,
      title: "Earn Yield",
      description: "Your assets automatically start earning competitive yields through our institutional-grade lending protocols.",
      step: "02",
      gradient: "bg-gradient-to-br from-orange-50 to-orange-100",
      iconBg: "bg-orange-500/10",
      iconColor: "text-orange-600"
    },
    {
      icon: <DollarSign className="h-8 w-8" />,
      title: "Get Instant Credit",
      description: "Access instant credit against your deposited assets without selling your positions.",
      step: "03",
      gradient: "bg-gradient-to-br from-purple-50 to-purple-100",
      iconBg: "bg-purple-500/10",
      iconColor: "text-purple-600"
    },
    {
      icon: <Shield className="h-8 w-8" />,
      title: "Secure & Withdraw",
      description: "Monitor your earnings and withdraw your assets anytime with full transparency and security.",
      step: "04",
      gradient: "bg-gradient-to-br from-green-50 to-green-100",
      iconBg: "bg-green-500/10",
      iconColor: "text-green-600"
    }
  ];

  return (
    <div className="bg-gray-50 py-20" id="how-it-works">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">How It Works</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Get started with STRATO Mercata in four simple steps and start earning on your assets today
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <div key={index} className="relative group">
                <div className={`${step.gradient} rounded-xl p-8 shadow-sm border border-gray-200 hover:shadow-lg hover:-translate-y-2 transition-all duration-300 ease-out h-full`}>
                  <div className="flex items-center justify-between mb-6">
                    <div className={`flex items-center justify-center w-16 h-16 ${step.iconBg} rounded-full ${step.iconColor} group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                      {step.icon}
                    </div>
                    <div className="text-6xl font-bold text-gray-200 leading-none group-hover:text-gray-300 transition-colors duration-300">
                      {step.step}
                    </div>
                  </div>
                  
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">
                    {step.title}
                  </h3>
                  
                  <p className="text-gray-600 leading-relaxed">
                    {step.description}
                  </p>
                </div>
                
                {/* Connecting line for desktop */}
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-20 -right-4 w-8 h-0.5 bg-gray-300 group-hover:bg-gray-400 transition-colors duration-300 z-10"></div>
                )}
              </div>
            ))}
          </div>
          
        </div>
      </div>
    </div>
  );
};

export default HowItWorks;