export interface TokenData {
  address: string;
  block_hash: string;
  block_timestamp: string;
  block_number: string;
  transaction_hash: string;
  transaction_sender: string;
  creator: string;
  root: string;
  contract_name: string;
  data: TokenMetadata;
  _name: string;
  _symbol: string;
  _totalSupply: number;
  "BlockApps-Mercata-ERC20-_balances": TokenBalance[];
}

export interface TokenMetadata {
  name: string;
  owner: string;
  purity: string;
  source: string;
  decimals: string;
  quantity: string;
  itemNumber: string;
  createdDate: string;
  description: string;
  originAddress: string;
  ownerCommonName: string;
  redemptionService: string;
  unitOfMeasurement: string;
  leastSellableUnits: string;
}

export interface TokenBalance {
  key: string;
  root: string;
  value: string;
  address: string;
  creator: string;
  block_hash: string;
  block_number: string;
  contract_name: string;
  collectionname: string;
  collectiontype: string;
  block_timestamp: string;
  transaction_hash: string;
  transaction_sender: string;
}