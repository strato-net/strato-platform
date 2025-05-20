export interface Token {
  address: string;
  block_hash: string;
  block_timestamp: string;
  block_number: string;
  transaction_hash: string;
  transaction_sender: string;
  creator: string;
  root: string;
  contract_name: string;
  collectionname: string;
  collectiontype: string;
  key: string;
  value: string;
  "BlockApps-Mercata-ERC20"?: {
    data: {
      token: string;
      oracle: string;
      stablecoin: string;
    };
    root: string;
    _name: string;
    _symbol: string;
    address: string;
    creator: string;
    block_hash: string;
    _totalSupply: number;
    block_number: string;
    contract_name: string;
    block_timestamp: string;
    transaction_hash: string;
    transaction_sender: string;
  };
};

export interface DepositableToken {
  address: string;
  _name: string;
  _symbol: string;
  value: string;           // Usually big numbers as strings
  collateralRatio: string; // string but represents a number
  interestRate: string;
  price: string;
  liquidity: string;
  ltv?: string
}
export interface SwappableToken {
  address: string;
  _name: string;
  _symbol: string;
  balance?: string;
  "BlockApps-Mercata-ERC20-_balances": {
    key: string;
    value: string;
  }[];
};

export interface Loan {
  active: boolean;
  amount: string;
  asset: string;
  collateralAmount: string;
  collateralAsset: string;
  lastUpdated: string;
  user: string;
  assetName: string;
  assetSymbol: string;
  collateralName: string;
  collateralSymbol: string;
  interest: string;
}