# Price Oracle Service

Fetches asset prices from multiple sources and pushes them to the STRATO blockchain.

## Features

- **Batch Updates**: Multiple assets updated in single transaction
- **Configurable Interval**: Update frequency via `UPDATE_INTERVAL_MINUTES` (1-60, default: 15)
- **Health Check Failover**: Automatic failover using `PRIMARY_ORACLE_URL`
- **Parallel Processing**: All feeds run simultaneously

## Environment Variables

```env
# STRATO Configuration
STRATO_NODE_URL=https://node1.mercata-testnet.blockapps.net/
PRICE_ORACLE_ADDRESS=0000000000000000000000000000000000001002

# OAuth Configuration
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid_configuration

# API Keys
ALCHEMY_API_KEY=your-alchemy-key
COINMARKETCAP_API_KEY=your-coinmarketcap-key
METALS_API_KEY=your-metals-dev-key
METALPRICE_API_KEY=your-metalprice-api-key

# Oracle Configuration
UPDATE_INTERVAL_MINUTES=15  # Update interval in minutes (1-60, default: 15)
PRIMARY_ORACLE_URL=http://primary-oracle:3000  # For failover instances only
```

## Failover Setup

**Primary Server:**
```env
# No PRIMARY_ORACLE_URL needed
```

**Failover Server:**
```env
PRIMARY_ORACLE_URL=http://primary-oracle:3000
```

## Development

```bash
npm run build
npm run dev
```

## Health Check

```bash
curl http://localhost:3000/health
``` 