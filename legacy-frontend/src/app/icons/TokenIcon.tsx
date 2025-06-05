"use client";

import React from 'react';

type TokenIconProps = {
  symbol: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
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
    STR: '#1f1f5f',
    LINK: '#2A5ADA',
    UNI: '#FF007A',
    AAVE: '#B6509E',
    SNX: '#00D1FF',
    CRV: '#3465A4',
    default: '#E2E8F0'
  };
  return colors[symbol] || colors.default;
};

export default function TokenIcon({ symbol, size = 'md', className = '' }: TokenIconProps) {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  };

  const bgColor = getTokenColor(symbol);

  return (
    <div 
      className={`rounded-full flex items-center justify-center ${sizeClasses[size]} ${className} shadow-sm`}
      style={{ 
        backgroundColor: bgColor,
        boxShadow: `0 2px 4px ${bgColor}40`
      }}
    >
      <span className="text-white font-semibold text-xs">
        {symbol.slice(0, 2)}
      </span>
    </div>
  );
} 