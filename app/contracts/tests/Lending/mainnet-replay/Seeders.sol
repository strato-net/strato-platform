// Helper contracts of the mainnet replay. gen_replay.py pastes this file into the generated test.

/// An AdminRegistry admin: votes by calling castVoteOnIssue, as the admin UI does.
contract Admin is User {
    function vote(address registry, address target, string func, variadic args) public returns (bool) {
        (bool executed, variadic ret) = AdminRegistry(registry).castVoteOnIssue(target, func, args);
        return executed;
    }
}

contract GasBurner {
    function burn(uint n) public returns (uint x) {
        for (uint i = 0; i < n; i++) { x += i; }
        return x;
    }
}

// Seeders: logic contracts a proxy runs first, declaring the real contract's storage under the same
// names so the snapshot can be written straight into it.
contract AdminSeeder {
    address[] public record admins;
    mapping (address => uint) public record adminMap;
    mapping (address => mapping (string => mapping (address => bool))) public record whitelist;
    uint public defaultVotingThresholdBps;
    uint public timelockDelay;
    uint public configVersion;
    function seedAdmins(address[] list) external {
        for (uint i = 0; i < list.length; i++) { admins.push(list[i]); adminMap[list[i]] = admins.length; }
    }
    function seedParams(uint thresholdBps, uint delay, uint version) external {
        defaultVotingThresholdBps = thresholdBps; timelockDelay = delay; configVersion = version;
    }
    function seedWhitelist(address target, string func, address user) external { whitelist[target][func][user] = true; }
}

contract TokenSeeder {
    mapping(address => uint256) private record _balances;
    uint256 private _totalSupply;
    string private _name;
    string private _symbol;
    bool private _erc20Initialized;
    uint8 public customDecimals;
    TokenStatus public status;
    TokenFactory public tokenFactory;
    function seedMeta(string name_, string symbol_, address factory_, uint totalSupply_) external {
        _name = name_; _symbol = symbol_; _erc20Initialized = true; customDecimals = 18;
        status = TokenStatus.ACTIVE; tokenFactory = TokenFactory(factory_); _totalSupply = totalSupply_;
    }
    function seedBalances(address[] who, uint[] amounts) external {
        for (uint i = 0; i < who.length; i++) { _balances[who[i]] = amounts[i]; }
    }
}

contract TokenFactorySeeder {
    mapping(address => bool) public isFactoryToken;
    address[] public record allTokens;
    function seedTokens(address[] list) external {
        for (uint i = 0; i < list.length; i++) { isFactoryToken[list[i]] = true; allTokens.push(list[i]); }
    }
}

contract OracleSeeder {
    mapping(address => uint256) public record prices;
    mapping(address => uint256) public record lastUpdated;
    uint256 public queueSize;
    function seedPrices(address[] assets, uint[] values, uint stamp) external {
        for (uint i = 0; i < assets.length; i++) { prices[assets[i]] = values[i]; lastUpdated[assets[i]] = stamp; }
        queueSize = 2;
    }
}

contract RegistrySeeder {
    LendingPool public lendingPool;
    LiquidityPool public liquidityPool;
    CollateralVault public collateralVault;
    RateStrategy public rateStrategy;
    PriceOracle public priceOracle;
    function seed(address lp, address liq, address cv, address rs, address po) external {
        lendingPool = LendingPool(lp); liquidityPool = LiquidityPool(liq); collateralVault = CollateralVault(cv);
        rateStrategy = RateStrategy(rs); priceOracle = PriceOracle(po);
    }
}

contract VaultSeeder {
    LendingRegistry public registry;
    mapping(address => mapping(address => uint)) public record userCollaterals;
    function seedRegistry(address r) external { registry = LendingRegistry(r); }
    function seedCollateral(address[] users, address[] assets, uint[] amounts) external {
        for (uint i = 0; i < users.length; i++) { userCollaterals[users[i]][assets[i]] = amounts[i]; }
    }
}

contract LiquiditySeeder {
    LendingRegistry public registry;
    Token public mToken;
    function seed(address r, address m) external { registry = LendingRegistry(r); mToken = Token(m); }
}

contract PoolSeeder {
    struct LoanInfo { uint scaledDebt; uint lastUpdated; }
    struct AssetConfig { uint ltv; uint liquidationThreshold; uint liquidationBonus; uint interestRate; uint reserveFactor; uint perSecondFactorRAY; }
    uint public RAY;
    uint public SECONDS_PER_YEAR;
    uint public borrowIndex;
    uint public lastAccrual;
    uint public totalScaledDebt;
    uint public reservesAccrued;
    uint public badDebt;
    uint public debtCeilingAsset;
    uint public debtCeilingUSD;
    uint public safetyShareBps;
    mapping(address => LoanInfo) public record userLoan;
    mapping(address => AssetConfig) public record assetConfigs;
    address[] public record configuredAssets;
    address public borrowableAsset;
    address public mToken;
    LendingRegistry public registry;
    TokenFactory public tokenFactory;
    address public poolConfigurator;
    FeeCollector public feeCollector;
    SafetyModule public safetyModule;
    function seedIndex(uint index, uint last, uint scaled, uint reserves, uint bad) external {
        RAY = 1000000000000000000000000000; SECONDS_PER_YEAR = 31536000;
        borrowIndex = index; lastAccrual = last; totalScaledDebt = scaled; reservesAccrued = reserves; badDebt = bad;
    }
    function seedParams(uint ceilingAsset, uint ceilingUsd, uint safetyBps) external {
        debtCeilingAsset = ceilingAsset; debtCeilingUSD = ceilingUsd; safetyShareBps = safetyBps;
    }
    function seedWiring(address asset, address m, address r, address tf, address pc, address fc, address sm) external {
        borrowableAsset = asset; mToken = m; registry = LendingRegistry(r); tokenFactory = TokenFactory(tf);
        poolConfigurator = pc; feeCollector = FeeCollector(fc); safetyModule = SafetyModule(sm);
    }
    function seedLoans(address[] users, uint[] scaled, uint[] updated) external {
        for (uint i = 0; i < users.length; i++) { userLoan[users[i]].scaledDebt = scaled[i]; userLoan[users[i]].lastUpdated = updated[i]; }
    }
    function seedAsset(address asset, uint ltv, uint lt, uint bonus, uint rate, uint rf, uint perSecond) external {
        configuredAssets.push(asset);
        assetConfigs[asset] = AssetConfig(ltv, lt, bonus, rate, rf, perSecond);
    }
}

contract SafetySeeder {
    LendingRegistry public lendingRegistry;
    LendingPool public lendingPool;
    LiquidityPool public liquidityPool;
    TokenFactory public tokenFactory;
    address public asset;
    address public sToken;
    uint public COOLDOWN_SECONDS;
    uint public UNSTAKE_WINDOW;
    mapping(address => uint) public record cooldownStart;
    uint public MAX_SLASH_BPS;
    uint256 private _managedAssets;
    function seedWiring(address r, address lp, address liq, address tf, address a, address s) external {
        lendingRegistry = LendingRegistry(r); lendingPool = LendingPool(lp); liquidityPool = LiquidityPool(liq);
        tokenFactory = TokenFactory(tf); asset = a; sToken = s;
    }
    function seedParams(uint cooldown, uint window, uint slash, uint managed) external {
        COOLDOWN_SECONDS = cooldown; UNSTAKE_WINDOW = window; MAX_SLASH_BPS = slash; _managedAssets = managed;
    }
    function seedCooldowns(address[] users, uint[] starts) external {
        for (uint i = 0; i < users.length; i++) { cooldownStart[users[i]] = starts[i]; }
    }
}
