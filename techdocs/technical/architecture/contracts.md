# Smart Contracts Architecture

STRATO Mercata uses SolidVM, a Solidity-compatible virtual machine with extended features for enterprise blockchain applications.

## Contract Structure

```
mercata/contracts/
├── abstract/           # Base contracts and interfaces
│   └── ERC20/         # ERC20 token standard implementation
├── concrete/          # Deployable contracts
│   ├── Admin/         # Platform administration
│   ├── Bridge/        # Cross-chain bridge
│   ├── CDP/           # Collateralized Debt Positions
│   ├── Lending/       # DeFi lending protocol
│   ├── Pools/         # Liquidity pools and AMM
│   ├── Proxy/         # Upgradeable proxy pattern
│   ├── Rewards/       # Incentive distribution
│   ├── Tokens/        # Token factory and metadata
│   └── Voucher/       # Fee voucher system
├── libraries/         # Shared libraries
├── deploy/            # Deployment scripts
└── tests/             # Contract tests
```

## Core Contracts

### Token System

#### Token.sol
ERC20-compatible token with extended features:
- Pausable transfers
- Burnable supply
- Metadata management
- Access control (Ownable, Authorizable)

```solidity
contract Token is ERC20, ERC20Pausable, ERC20Burnable, Ownable {
    constructor(string memory name, string memory symbol, uint256 initialSupply)
        ERC20(name, symbol)
    {
        _mint(msg.sender, initialSupply);
    }
}
```

#### TokenFactory.sol
Factory pattern for deploying new tokens:
- Standardized token creation
- Registry of deployed tokens
- Metadata association

#### TokenMetadata.sol
On-chain metadata storage:
- Name, symbol, decimals
- Additional attributes (icon, description)
- Updatable by owner

### Lending Protocol

#### LendingPool.sol
Core lending pool contract:
- Deposit/withdraw collateral
- Borrow/repay loans
- Interest rate calculation
- Liquidation mechanics

#### CollateralVault.sol
Secure collateral storage:
- Multi-asset support
- Health factor monitoring
- Liquidation triggers

#### LiquidityPool.sol
Liquidity provision:
- LP token minting/burning
- Fee distribution
- Impermanent loss tracking

#### RateStrategy.sol
Interest rate model:
- Utilization-based rates
- Configurable parameters
- Jump rate model support

#### SafetyModule.sol
Protocol safety mechanisms:
- Emergency pause
- Bad debt handling
- Reserve management

#### PriceOracle.sol
Price feed integration:
- Multi-source support
- Staleness checks
- Fallback mechanisms

### CDP (Collateralized Debt Positions)

#### CDPEngine.sol
Main CDP logic:
- Vault creation
- Debt management
- Collateral ratio enforcement

#### CDPVault.sol
Individual CDP storage:
- Collateral deposits
- Debt tracking
- Interest accrual

#### CDPRegistry.sol
CDP registry:
- Vault enumeration
- User position lookup
- Statistics aggregation

#### CDPReserve.sol
Protocol reserves:
- Stability fees
- Liquidation penalties
- Surplus/deficit management

### AMM Pools

#### Pool.sol
Automated Market Maker:
- Constant product formula (x * y = k)
- Swap execution
- Slippage protection
- Fee collection

#### PoolFactory.sol
Pool deployment factory:
- Pair creation
- Pool registry
- Fee configuration

### Rewards System

#### Rewards.sol
Basic rewards distribution:
- Reward token staking
- Proportional distribution
- Claim mechanics

#### RewardsChef.sol
MasterChef-style rewards:
- Multiple pool support
- Allocation points
- Emission scheduling
- Bonus periods

### Bridge

#### MercataBridge.sol
Cross-chain asset transfer:
- Lock/unlock mechanics
- Validator signatures
- Nonce management
- Fee handling

### Administration

#### AdminRegistry.sol
Platform administration:
- Admin role management
- Permission checks
- Multi-sig support

#### FeeCollector.sol
Protocol fee management:
- Fee aggregation
- Distribution rules
- Treasury management

### Voucher System

#### Voucher.sol
Fee voucher tokens:
- Gas fee subsidies
- Promotional credits
- Expiration handling

#### PayFeesWithVoucher.sol
Voucher payment integration:
- Fee calculation
- Voucher redemption
- Fallback to native payment

## Abstract Contracts (ERC20)

### Base Implementation

```
abstract/ERC20/
├── ERC20.sol              # Core ERC20 implementation
├── IERC20.sol             # Interface definition
├── access/
│   ├── Ownable.sol        # Single owner access control
│   └── Authorizable.sol   # Multi-user authorization
├── extensions/
│   ├── ERC20Burnable.sol  # Burn functionality
│   ├── ERC20Pausable.sol  # Pause transfers
│   ├── ERC20Permit.sol    # Gasless approvals (EIP-2612)
│   ├── ERC20Votes.sol     # Governance voting
│   └── ERC20Wrapper.sol   # Wrapped token pattern
└── utils/
    ├── Context.sol        # Msg.sender abstraction
    ├── Pausable.sol       # Pause mechanism
    └── StringUtils.sol    # String utilities
```

## Deployment

### Prerequisites

1. Node.js and npm/yarn
2. OAuth credentials for STRATO node
3. Deployer account with sufficient balance

### Configuration

Create `.env` file:
```bash
NODE_URL=https://your-node.example.com
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
```

### Deploy Commands

```bash
cd mercata/contracts

# Install dependencies
npm install

# Deploy all contracts
npm run deploy

# Deploy specific contract
npm run deploy -- --contract Token

# Upgrade contract
npm run upgrade -- --contract AdminRegistry
```

### Deployment Script Structure

```javascript
// deploy/deploy.js
const { deployContract, getAccount } = require('./util');

async function main() {
  const deployer = await getAccount();
  
  // Deploy TokenFactory
  const tokenFactory = await deployContract({
    name: 'TokenFactory',
    args: []
  });
  
  // Deploy with constructor args
  const token = await deployContract({
    name: 'Token',
    args: ['MyToken', 'MTK', '1000000000000000000000000']
  });
}
```

## Testing

### Run Tests

```bash
cd mercata/contracts

# Run all tests
npm test

# Run specific test
npm test -- --grep "Token"

# Run with verbose output
npm test -- --verbose
```

### Test Structure

```solidity
// tests/Token/Token.test.sol
pragma solidvm 12.0;

import "../../concrete/Tokens/Token.sol";
import "../Util.sol";

contract TokenTest {
    Token token;
    
    function setUp() public {
        token = new Token("Test", "TST", 1000000 * 10**18);
    }
    
    function testTransfer() public {
        address recipient = address(0x1234);
        token.transfer(recipient, 100 * 10**18);
        assert(token.balanceOf(recipient) == 100 * 10**18);
    }
}
```

## SolidVM Features

### Pragmas

```solidity
pragma solidvm 12.0;      // Enable latest features
pragma strict;            // Strict visibility modifiers
pragma es6;              // Braced/qualified imports
pragma safeExternalCalls; // Type-safe external calls
```

### Decimal Type

```solidity
pragma solidvm 11.3;

contract DecimalExample {
    decimal public price = 123.456;
    
    function calculate(decimal amount) public view returns (decimal) {
        return price * amount;
    }
    
    function toUint(decimal d) public pure returns (uint) {
        return d.truncate(2); // Truncate to 2 decimal places
    }
}
```

### Built-in Functions

```solidity
// Address accessors
address.nonce     // Get account nonce
address.creator   // Get contract creator
address.root      // Get original contract address

// Contract creation
create(bytecode, salt, args)   // Deterministic deployment
create2(bytecode, salt)        // EIP-1014 compatible

// Cryptographic
keccak256(data)   // Returns hex-encoded hash
```

### Abstract Contracts

```solidity
pragma solidvm 10.0;

abstract contract Asset {
    string public name;
    function transfer(address to, uint amount) public virtual;
}

contract Token is Asset {
    mapping(address => uint) balances;
    
    function transfer(address to, uint amount) public override {
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
}
```

## Cirrus Integration

Slipstream automatically indexes contract state to PostgreSQL:

### Table Structure

Each contract gets a table named after its contract name:
```sql
-- Token contract creates Token table
SELECT * FROM "Token" WHERE address = '0x1234...';

-- Mappings get separate tables
SELECT * FROM "Token_balances" WHERE key = '0xuser...';
```

### Indexed Events

Events with `indexed` keyword create separate tables:
```solidity
event Transfer(
    address indexed from,
    address indexed to,
    uint256 value
);
```

Creates `Transfer@` table with indexed columns as primary keys.

## Related Documentation

- [Architecture Overview](README.md)
- [STRATO API](strato-api.md)
- [Lending Documentation](../mercata/Lending.md)
- [Rewards Documentation](../mercata/Rewards.md)
