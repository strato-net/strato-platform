import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3006', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Blockchain
  stratoUrl: process.env.STRATO_URL || 'http://localhost:3000',
  oauthUrl: process.env.OAUTH_URL || 'http://localhost:3001',

  // Bot Account
  botAddress: process.env.BOT_ADDRESS || '',
  botPrivateKey: process.env.BOT_PRIVATE_KEY || '',
  botOAuthToken: process.env.BOT_OAUTH_TOKEN || '',

  // Polling
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
  maxLiquidationsPerBatch: parseInt(process.env.MAX_LIQUIDATIONS_PER_BATCH || '10', 10),

  // CDP
  cdpEngineAddress: process.env.CDP_ENGINE_ADDRESS || '',
  cdpRegistryAddress: process.env.CDP_REGISTRY_ADDRESS || '',

  // Lending
  lendingPoolAddress: process.env.LENDING_POOL_ADDRESS || '',
  lendingRegistryAddress: process.env.LENDING_REGISTRY_ADDRESS || '',

  // Strategy
  minProfitThresholdUsd: parseFloat(process.env.MIN_PROFIT_THRESHOLD_USD || '10'),
  maxGasPriceGwei: parseInt(process.env.MAX_GAS_PRICE_GWEI || '100', 10),
  enableCdpLiquidations: process.env.ENABLE_CDP_LIQUIDATIONS === 'true',
  enableLendingLiquidations: process.env.ENABLE_LENDING_LIQUIDATIONS === 'true',

  // Managed Vault
  vaultEnabled: process.env.VAULT_ENABLED === 'true',
  minInvestmentUsd: parseFloat(process.env.MIN_INVESTMENT_USD || '100'),
  vaultFeeBps: parseInt(process.env.VAULT_FEE_BPS || '500', 10),

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};
