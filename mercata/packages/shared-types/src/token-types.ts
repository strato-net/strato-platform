export interface Token {
  address: string;
  _name: string;
  _symbol: string;
  _owner: string;
  _totalSupply: string;
  customDecimals: number;
  description: string;
  status: string;
  _paused: boolean;
  balance: string;
  images: Array<{ value: string }>;
  attributes: Array<{ key: string; value: string }>;
  price: string;
}

export interface EarningAsset extends Token {
  collateralBalance: string;
  isPoolToken: boolean;
  value: string;
}

export interface NetBalanceSnapshot {
  timestamp: number;
  netBalance: number;
}
