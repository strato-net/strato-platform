import { ReactNode } from 'react';

export interface ConnectButtonProps {
  label?: ReactNode;
  showBalance?: boolean;
  accountStatus?: 'full' | 'avatar' | 'address' | 'none';
  chainStatus?: 'full' | 'icon' | 'name' | 'none';
  avatar?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
}