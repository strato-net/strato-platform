import {
  Wallet,
  TrendingUp,
  ArrowLeftRight,
  ChevronRight
} from 'lucide-react';
import { Link } from 'react-router-dom';

type Service = {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  color: string;
  link?: string;
};

const SERVICES: Service[] = [
  {
    icon: <Wallet className="w-8 h-8" />,
    title: 'Deposit & Earn',
    description: 'Deposit your assets and watch them grow with competitive yields through our lending pools.',
    features: ['Competitive APY rates', 'Multiple asset classes', 'No lock-up periods', 'Instant withdrawals'],
    color: 'from-blue-500 to-blue-600',
    link: '/dashboard',
  },
  {
    icon: <TrendingUp className="w-8 h-8" />,
    title: 'Borrow',
    description: 'Access instant liquidity by borrowing USDST against your crypto and tokenized assets.',
    features: ['Flexible collateral options', 'Competitive interest rates', 'Real-time health monitoring', 'No credit checks'],
    color: 'from-green-500 to-green-600',
    link: '/dashboard',
  },
  {
    icon: <ArrowLeftRight className="w-8 h-8" />,
    title: 'Bridge',
    description: 'Seamlessly transfer your assets across different blockchains with our secure bridge.',
    features: ['Cross-chain transfers', 'Fast settlements', 'Secure protocols', 'Multiple chains supported'],
    color: 'from-orange-500 to-orange-600',
    link: '/dashboard',
  },
];

const Services = () => {
  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-[#001f5c] mb-4">
              Everything You Need in One Platform
            </h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              Mercata offers a comprehensive suite of DeFi services designed to help you maximize your returns and manage your diverse asset portfolio with ease.
            </p>
          </div>

          {/* Services Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {SERVICES.map((service, index) => (
              <div
                key={index}
                className="group bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 border border-gray-100 overflow-hidden"
              >
                {/* Icon Header */}
                <div className={`h-2 bg-gradient-to-r ${service.color}`} />

                <div className="p-8">
                  {/* Icon */}
                  <div className={`inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br ${service.color} rounded-xl mb-6 text-white transform group-hover:scale-110 transition-transform duration-300`}>
                    {service.icon}
                  </div>

                  {/* Title */}
                  <h3 className="text-2xl font-bold text-[#001f5c] mb-3">
                    {service.title}
                  </h3>

                  {/* Description */}
                  <p className="text-gray-600 mb-6 leading-relaxed">
                    {service.description}
                  </p>

                  {/* Features */}
                  <ul className="space-y-2 mb-6">
                    {service.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start text-sm text-gray-700">
                        <span className="inline-block w-1.5 h-1.5 bg-[#f5a623] rounded-full mt-2 mr-3 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Link */}
                  {service.link && (
                    <Link
                      to={service.link}
                      className="inline-flex items-center text-[#001f5c] font-semibold hover:text-[#f5a623] transition-colors group/link"
                    >
                      Learn more
                      <ChevronRight className="ml-1 w-4 h-4 transform group-hover/link:translate-x-1 transition-transform" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom CTA */}
          <div className="text-center mt-16">
            <p className="text-gray-600 mb-6 text-lg">
              Ready to explore all features?
            </p>
            <Link
              to="/dashboard"
              className="inline-flex items-center bg-[#001f5c] hover:bg-[#003580] text-white px-8 py-4 rounded-full font-bold text-sm uppercase tracking-wide transition-all shadow-lg hover:shadow-xl"
            >
              Launch App
              <ChevronRight className="ml-2 h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Services;
