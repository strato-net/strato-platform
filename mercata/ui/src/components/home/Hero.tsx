import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const Hero = () => {
  return (
    <div className="relative pt-16 overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: 'url(/marketplaceBG.png)'
        }}
      />
      
      {/* Dark overlay for better text readability */}
      <div className="absolute inset-0 bg-black/40" />
      
      {/* Bottom fade gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white via-white/80 to-transparent" />
      <div className="container mx-auto px-4 py-20 relative z-10">
        {/* Hero Header */}
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-gray-300 drop-shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-200">
            Where Stability Meets Opportunity
          </h1>
          <p className="text-xl md:text-2xl mb-8 text-gray-400 drop-shadow-md animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-100">
            Easily earn on vaulted gold, silver & crypto. Get instant credit. Built by ETH veterans.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              to="/dashboard"
              className="group bg-strato-blue hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors shadow-lg flex items-center justify-center"
            >
              Launch STRATO
              <ChevronRight className="ml-2 h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="group relative bg-white/10 backdrop-blur-md border border-white/30 rounded-2xl p-8 text-center shadow-2xl hover:shadow-3xl hover:-translate-y-3 hover:bg-white/20 transition-all duration-500 before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-white/20 before:to-transparent before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300">
            <div className="relative z-10 text-4xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent mb-3">
              $5 Million
            </div>
            <div className="relative z-10 text-gray-300 font-medium">Total Value Locked</div>
            <div className="relative z-10 mt-4 h-1 w-16 bg-gradient-to-r from-strato-blue to-strato-purple rounded-full mx-auto opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          </div>
          <div className="group relative bg-white/10 backdrop-blur-md border border-white/30 rounded-2xl p-8 text-center shadow-2xl hover:shadow-3xl hover:-translate-y-3 hover:bg-white/20 transition-all duration-500 before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-white/20 before:to-transparent before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300">
            <div className="relative z-10 text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent mb-3">
              6.5%
            </div>
            <div className="relative z-10 text-gray-300 font-medium">Average APY</div>
            <div className="relative z-10 mt-4 h-1 w-16 bg-gradient-to-r from-green-600 to-emerald-600 rounded-full mx-auto opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          </div>
          <div className="group relative bg-white/10 backdrop-blur-md border border-white/30 rounded-2xl p-8 text-center shadow-2xl hover:shadow-3xl hover:-translate-y-3 hover:bg-white/20 transition-all duration-500 before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-white/20 before:to-transparent before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300">
            <div className="relative z-10 text-4xl font-bold bg-gradient-to-r from-strato-orange to-yellow-600 bg-clip-text text-transparent mb-3">
              60,000+
            </div>
            <div className="relative z-10 text-gray-300 font-medium">Rewards Issued (Cata)</div>
            <div className="relative z-10 mt-4 h-1 w-16 bg-gradient-to-r from-strato-orange to-yellow-600 rounded-full mx-auto opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
