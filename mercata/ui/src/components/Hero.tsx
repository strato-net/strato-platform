import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { InteractiveGridPattern } from "@/components/magicui/interactive-grid-pattern";
import { cn } from "@/lib/utils";

const Hero = () => {
  return (
    <div className="relative bg-white pt-16 overflow-hidden">
      <InteractiveGridPattern
        className={cn(
          "[mask-image:radial-gradient(400px_circle_at_center,white,transparent)]",
          "inset-x-0 inset-y-[-30%] h-[200%] skew-y-12",
        )}
      />
      <div className="container mx-auto px-4 py-20 relative z-10">
        {/* Hero Header */}
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-gray-900">
            Where Stability Meets Opportunity
          </h1>
          <p className="text-xl md:text-2xl mb-8 text-gray-600">
            Easily earn on vaulted gold, silver & crypto. Get instant credit. Built by ETH veterans.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              to="/dashboard"
              className="bg-strato-blue hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Launch STRATO
            </Link>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center shadow-sm">
            <div className="text-3xl font-bold text-gray-900 mb-2">$5 Million</div>
            <div className="text-gray-600">Total Value Locked</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center shadow-sm">
            <div className="text-3xl font-bold text-gray-900 mb-2">6.5%</div>
            <div className="text-gray-600">Average APY</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center shadow-sm">
            <div className="text-3xl font-bold text-gray-900 mb-2">60,000</div>
            <div className="text-gray-600">Rewards Issued (Cata)</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
