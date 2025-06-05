"use client";

import React from 'react';

type NetworkIconProps = {
  network: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const getNetworkColor = (network: string): string => {
  const colors: { [key: string]: string } = {
    Ethereum: '#627EEA',
    Optimism: '#FF0420',
    Arbitrum: '#28A0F0',
    Polygon: '#8247E5',
    default: '#E2E8F0'
  };
  return colors[network] || colors.default;
};

export default function NetworkIcon({ network, size = 'md', className = '' }: NetworkIconProps) {
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-10 h-10'
  };

  const bgColor = getNetworkColor(network);

  return (
    <div 
      className={`rounded-full flex items-center justify-center ${sizeClasses[size]} ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      <span className="text-white font-semibold text-xs">
        {network.slice(0, 2)}
      </span>
    </div>
  );
} 