# Mercata Base Code Collection Contract Deployer

A modular JavaScript tool for combining and deploying SOLIDVM contracts to the Mercata blockchain.

## Features

- Combines SOLIDVM contracts from your BCC directory
- Loads all configuration from a `.env` file
- Simple deployment with no constructor arguments
- Clean, modular code structure

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

4. Add your SOLIDVM contracts to the `BCC` directory:

```bash
cd BCC
# Add/Update your .sol files to the BCC directory
# If new abstract contract is written, add to BaseCodeCollection.sol
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
CONTRACTS_DIR=./BCC
MAIN_FILE=YourContract.sol  # Code collection contract file (optional)
APP_NAME=YourAppName        # Name of the app (optional)
```

Required environment variables:
- `GLOBAL_ADMIN_NAME` - Admin username
- `GLOBAL_ADMIN_PASSWORD` - Admin password

Optional environment variables:
- `MAIN_FILE` - Code collection contract file to start with (if not specified, BaseCodeCollection.sol will be used.)

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
project/
  |-- Deploy/
  |    |-- deploy.js        # Main deployment script
  |    |-- auth.js          # Authentication utilities
  |    |-- contract.js      # Contract utilities
  |    |-- config.js        # Configuration loader
  |-- BCC/                  # Directory for abstract SOLIDVM contracts
  |-- Assets/               # Directory for concrete SOLIDVM contracts
  |-- .env                  # Environment variables
  |-- package.json          # Project dependencies
```

## How It Works

The deployment process follows these steps:

1. **Authentication**: Uses the admin credentials to obtain an access token
2. **Contract Combination**: Finds the code collection contract file and uses `importer.combine()` to combine it with all its dependencies
3. **Deployment**: Deploys the combined contract using `rest.createContract()` with no constructor arguments
4. **Results**: Returns and logs the deployed contract address

## Programmatic Usage

You can also use this tool programmatically:

```javascript
const deploy = require('./scripts/deploy');

async function run() {
  try {
    const deployedContract = await deploy();
    console.log(`Contract deployed at: ${deployedContract.address}`);
  } catch (error) {
    console.error('Deployment failed:', error);
  }
}

run();
```