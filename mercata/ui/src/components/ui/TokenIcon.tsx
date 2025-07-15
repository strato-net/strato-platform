// Reusable TokenIcon component for consistent token display across the app
import React from "react";

interface TokenIconProps {
  symbol: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const TokenIcon: React.FC<TokenIconProps> = ({ symbol, size = "md", className = "" }) => {
  // Get size classes
  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-xs", 
    lg: "w-10 h-10 text-sm"
  };

  // Get symbol abbreviation (first 2 characters)
  const abbrev = symbol ? symbol.slice(0, 2).toUpperCase() : "??";

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center text-white font-medium ${className}`}
      style={{ backgroundColor: "red" }}
    >
      {abbrev}
    </div>
  );
};

export default TokenIcon; 