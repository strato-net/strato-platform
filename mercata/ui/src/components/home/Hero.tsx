import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import heroBackground from '../../assets/home/hero-background.png';

const Hero = () => {
  return (
    <div className="relative pt-16 overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${heroBackground})`
        }}
      />
      <div className="container mx-auto px-4 py-48 relative z-10">
        {/* Hero Header */}
        <div className="max-w-2xl">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-8 text-[#001f5c] leading-tight animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-200">
            WHERE STABILITY MEETS OPPORTUNITY
          </h1>
          <p className="text-lg md:text-xl mb-10 text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-100">
            Diverse asset classes, one platform. From crypto to precious metals to tokenized securities—investing made simple for everyone.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              to="/dashboard"
              className="group bg-[#f5a623] hover:bg-[#e09615] text-[#001f5c] px-10 py-4 rounded-full font-bold text-sm uppercase tracking-wide transition-all shadow-lg hover:shadow-xl flex items-center justify-center w-fit"
            >
              START EARNING
              <ChevronRight className="ml-2 h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
