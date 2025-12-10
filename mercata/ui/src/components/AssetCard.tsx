
import { ArrowUpRight } from 'lucide-react';

interface AssetCardProps {
  title: string;
  type: string;
  image: string;
  logoColor: string;
  logoText: string;
  description: string;
}

const AssetCard = ({ title, type, image, logoColor, logoText, description }: AssetCardProps) => {
  return (
    <div className="asset-card group">
      <div className="flex items-center mb-6 relative">
        <div className={`asset-circle border-${logoColor}`} style={{ borderColor: logoColor }}>
          <img src={image} alt={title} className="w-full h-full object-cover" />
        </div>
        <div 
          className={`absolute top-0 right-0 w-16 h-16 rounded-full flex items-center justify-center text-white text-xs font-bold`}
          style={{ backgroundColor: logoColor }}
        >
          {logoText}
        </div>
      </div>
      <div className="text-left">
        <div className="text-sm font-semibold text-blue-600 mb-1">{type}</div>
        <h3 className="text-xl font-bold mb-2">{title}</h3>
        <p className="text-muted-foreground text-sm mb-6">{description}</p>
        <a 
          href="#view-project" 
          className="inline-flex items-center text-strato-blue hover:text-strato-purple font-medium text-sm transition-colors"
        >
          View Project <ArrowUpRight className="ml-1 h-4 w-4" />
        </a>
      </div>
    </div>
  );
};

export default AssetCard;
