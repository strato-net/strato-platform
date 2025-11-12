import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles, Shield, Zap } from 'lucide-react';

const CallToAction = () => {
  return (
    <section className="py-20 bg-gradient-to-br from-[#001f5c] via-[#003580] to-[#001f5c] relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-10 left-10 w-72 h-72 bg-[#f5a623] rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-400 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-6 py-2 mb-8">
            <Sparkles className="w-4 h-4 text-[#f5a623] mr-2" />
            <span className="text-sm font-semibold text-white">Start Earning Today</span>
          </div>

          {/* Main Heading */}
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
            Your Assets.<br />
            <span className="text-[#f5a623]">Your Opportunity.</span>
          </h2>

          {/* Description */}
          <p className="text-xl text-gray-200 mb-12 max-w-3xl mx-auto leading-relaxed">
            Join thousands of users who are already earning competitive yields on their crypto, precious metals, and tokenized assets. No minimum deposit required.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link
              to="/dashboard"
              className="group bg-[#f5a623] hover:bg-[#e09615] text-[#001f5c] px-10 py-5 rounded-full font-bold text-lg uppercase tracking-wide transition-all shadow-2xl hover:shadow-[#f5a623]/50 flex items-center justify-center"
            >
              Get Started Now
              <ChevronRight className="ml-2 h-6 w-6 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
            <Link
              to="/dashboard"
              className="group bg-white/10 backdrop-blur-sm hover:bg-white/20 text-white border-2 border-white/30 px-10 py-5 rounded-full font-bold text-lg uppercase tracking-wide transition-all flex items-center justify-center"
            >
              Explore Features
            </Link>
          </div>

          {/* Trust Indicators */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center mb-4 border border-white/20">
                <Shield className="w-7 h-7 text-[#f5a623]" />
              </div>
              <h3 className="text-white font-bold text-lg mb-2">Secure & Audited</h3>
              <p className="text-gray-300 text-sm">
                Built with industry-leading security standards and smart contract audits
              </p>
            </div>

            <div className="flex flex-col items-center">
              <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center mb-4 border border-white/20">
                <Zap className="w-7 h-7 text-[#f5a623]" />
              </div>
              <h3 className="text-white font-bold text-lg mb-2">Instant Access</h3>
              <p className="text-gray-300 text-sm">
                Connect your wallet and start earning in minutes, no KYC required
              </p>
            </div>

            <div className="flex flex-col items-center">
              <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center mb-4 border border-white/20">
                <Sparkles className="w-7 h-7 text-[#f5a623]" />
              </div>
              <h3 className="text-white font-bold text-lg mb-2">Diverse Assets</h3>
              <p className="text-gray-300 text-sm">
                From crypto to precious metals - invest in what you believe in
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CallToAction;
