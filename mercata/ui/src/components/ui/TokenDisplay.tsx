// Reusable TokenDisplay component for consistent token display with icon, name and symbol
import React from "react";
import TokenIcon from "./TokenIcon";

interface TokenDisplayProps {
  symbol: string;
  name?: string;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
}

const TokenDisplay: React.FC<TokenDisplayProps> = ({ 
  symbol, 
  name, 
  size = "md", 
  showName = true,
  className = "" 
}) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <TokenIcon symbol={symbol} size={size} />
      <div>
        {showName && name && (
          <div className="font-medium">{name}</div>
        )}
        <div className="text-xs text-muted-foreground">{symbol}</div>
      </div>
    </div>
  );
};

export default TokenDisplay; 