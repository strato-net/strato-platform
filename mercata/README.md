# Mercata Base Code Collection Contract Deployer

A modular JavaScript tool for combining and deploying SOLIDVM contracts to the Mercata blockchain.

## Features

- Combines abstract SOLIDVM contracts and deploys it as Base Code Collection (bcc)
- Loads all configuration from a `.env` file

## Prerequisites

- Node.js 14.x or higher
- npm or yarn

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with your configuration:

```bash
cp .env.sample .env
# Edit .env with your configuration
```

## Configuration

All configuration is loaded from the `.env` file:

```
# BlockApps Node Configuration
NODE_URL=https://node1.mercata-testnet2.blockapps.net
OAUTH_URL=https://keycloak.blockapps.net
OAUTH_REALM=mercata-testnet2
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret

# User Credentials
GLOBAL_ADMIN_NAME=your-username
GLOBAL_ADMIN_PASSWORD=your-password

# Contract Configuration
CONTRACT_VERSION=ContractVersion # Default: v1 (optional)
MAIN_FILE=YourContract.sol       # Code collection contract file (optional)
APP_NAME=YourAppName             # Name of the app (optional)
```

Required environment variables:
- `GLOBAL_ADMIN_NAME` - Admin username
- `GLOBAL_ADMIN_PASSWORD` - Admin password

Optional environment variables:
- `CONTRACT_VERSION` - Version of Mercata contracts to deploy (if not specified, uses `v1` inside contracts directory.)
- `MAIN_FILE` - Code collection contract file to start with (if not specified, `BaseCodeCollection.sol` will be used.)
- `APP_NAME` - Name of the app the bcc will be deployed to (if not specified, `Mercata` will be used)

## Usage

To deploy your contracts:

```bash
npm run deploy
```

This will:
1. Load configuration from `.env`
2. Authenticate with the BlockApps node
3. Combine all SOLIDVM contracts starting with the main file
4. Deploy the contract with no constructor arguments
5. Output the deployed contract address

## Project Structure

```
mercata/
  |-- deploy/
  |    |-- deploy.js        # Main deployment script
  |    |-- auth.js          # Authentication utilities
  |    |-- contract.js      # Contract utilities
  |    |-- config.js        # Configuration loader
  |-- contracts/
  |    |-- v#/              # Directory specifying the version of contracts to use  
  |    |    |-- abstract/   # Directory for abstract SOLIDVM contracts
  |    |    |-- concrete/   # Directory for concrete SOLIDVM contracts
  |-- .env.sample           # Environment variable template
  |-- package.json          # Project dependencies
  |-- README.md             # Project info.
```

## How It Works

The deployment process follows these steps:

1. **Authentication**: Uses the admin credentials to obtain an access token
2. **Contract Combination**: Finds the code collection contract file and uses `importer.combine()` to combine it with all its dependencies
3. **Deployment**: Deploys the combined contract using `rest.createContract()` with no constructor arguments
4. **Results**: Returns and logs the deployed contract address
