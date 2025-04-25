"use client";

import React from 'react';

type TokenIconProps = {
  symbol: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const getTokenColor = (symbol: string): string => {
  const colors: { [key: string]: string } = {
    ETH: '#627EEA',
    WETH: '#627EEA',
    USDC: '#2775CA',
    USDT: '#26A17B',
    DAI: '#F5AC37',
    WBTC: '#F09242',
    ARB: '#28A0F0',
    OP: '#FF0420',
    MATIC: '#8247E5',
    default: '#E2E8F0'
  };
  return colors[symbol] || colors.default;
};

export default function TokenIcon({ symbol, size = 'md', className = '' }: TokenIconProps) {
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-10 h-10'
  };

  const bgColor = getTokenColor(symbol);

  return (
    <div 
      className={`rounded-full flex items-center justify-center ${sizeClasses[size]} ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      <span className="text-white font-semibold text-xs">
        {symbol.slice(0, 2)}
      </span>
    </div>
  );
} 