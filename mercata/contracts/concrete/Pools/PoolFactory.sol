/**
 * @title PoolFactory
 * @notice Factory pattern contract that standardizes pool creation and tracking
 * @dev While pools are created here, users interact directly with pool contracts after creation
 *
 * The factory serves three main purposes:
 * 1. Standardized pool creation (owner only)
 * 2. Pool registry - lookup existing pools for tokenA pairs
 * 3. Pool tracking - maintain list of all created pools
 *
 * Similar to Uniswap's factory pattern:
 * - Use factory to find/create pools
 * - All trading/core functions happen directly with pool contracts
 */

import "Pool.sol";
import "StablePool.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Proxy/Proxy.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";

/// @notice Pool factory contract
contract record PoolFactory is Ownable {

    // ============ EVENTS ============

    /// @notice Event emitted when a new pool is created
    event NewPool(address tokenA, address tokenB, address pool);

    /// @notice Event emitted when pools are migrated
    event PoolsMigrated(address oldFactory, address newFactory, uint256 poolCount);

    /// @notice Event emitted when stable pools are merged into a new multi-token pool
    event PoolsMerged(address[] oldPools, address newPool);

    /// @notice Event emitted when the admin registry is updated
    event AdminRegistryUpdated(address newRegistry);

    /// @notice Event emitted when the token factory is updated
    event TokenFactoryUpdated(address newFactory);

    /// @notice Event emitted when fee collectors are updated
    event FeeCollectorsUpdated(address newFeeCollector);

    /// @notice Event emitted when fee parameters are updated
    event FeeParametersUpdated(uint256 newSwapFeeRate, uint256 newLpSharePercent);

    /// @notice Event emitted when pool fee parameters are updated
    event PoolFeeParametersUpdated(address poolAddress, uint256 newSwapFeeRate, uint256 newLpSharePercent);

    // ============ STATE VARIABLES ============

    /// @notice Mapping of tokenA/tokenB pairs to pool addresses
    mapping(address => mapping(address => address)) public record pools;

    /// @notice Array of all pool addresses
    address[] public record allPools;

    /// @notice Admin registry contract address
    address public adminRegistry;

    /// @notice Token factory contract address
    address public tokenFactory;

    /// @notice Fee collector address
    address public feeCollector;

    /// @notice Swap fee rate in basis points (e.g., 30 = 0.3%)
    uint256 public swapFeeRate;

    /// @notice LP share percentage in basis points (e.g., 7000 = 70%)
    uint256 public lpSharePercent;

    address public poolImplementation;
    address public stablePoolImplementation;

    // ============ CONSTRUCTOR ============

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    constructor(address initialOwner) Ownable(initialOwner) { }

    /// @notice Initialize the contract
    /// @param _tokenFactory The address of the token factory
    /// @param _adminRegistry The address of the admin registry
    /// @param _feeCollector The address of the fee collector
    function initialize(address _tokenFactory, address _adminRegistry, address _feeCollector) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        require(_tokenFactory  != address(0), "Zero token factory address");
        require(_feeCollector  != address(0), "Zero fee collector address");

        adminRegistry = _adminRegistry;
        tokenFactory = _tokenFactory;
        feeCollector = _feeCollector;
        swapFeeRate = 30;
        lpSharePercent = 7000;

        emit FeeParametersUpdated(swapFeeRate, lpSharePercent);
        emit FeeCollectorsUpdated(feeCollector);
        emit AdminRegistryUpdated(adminRegistry);
        emit TokenFactoryUpdated(tokenFactory);
    }

    // ============ MODIFIERS ============

    /// @notice Modifier to check if tokens are active
    /// @param tokenA First token address
    /// @param tokenB Second token address
    modifier tokensActive(address tokenA, address tokenB) {
        require(TokenFactory(tokenFactory).isTokenActive(tokenA) && TokenFactory(tokenFactory).isTokenActive(tokenB), "Token not active");
        _;
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Update the admin registry address (owner only)
    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        address oldRegistry = address(adminRegistry);
        adminRegistry = _adminRegistry;
        emit AdminRegistryUpdated(_adminRegistry);
    }

    /// @notice Update the token factory address (owner or admin)
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        require(_tokenFactory != address(0), "Zero token factory address");
        address oldFactory = address(tokenFactory);
        tokenFactory = _tokenFactory;
        emit TokenFactoryUpdated(_tokenFactory);
    }

    /// @notice Update the fee collector address (owner or admin)
    /// @dev This updates the factory's fee collector - pools read from factory
    function setFeeCollector(address newFeeCollector) external onlyOwner {
        require(newFeeCollector != address(0), "Zero fee collector address");
        address oldFeeCollector = feeCollector;
        feeCollector = newFeeCollector;

        emit FeeCollectorsUpdated(newFeeCollector);
    }

    /// @notice Update fee parameters for the factory (owner or admin)
    /// @param newSwapFeeRate New swap fee rate in basis points
    /// @param newLpSharePercent New LP share percentage in basis points
    function setFeeParameters(
        uint256 newSwapFeeRate,
        uint256 newLpSharePercent
    ) external onlyOwner {
        require(newSwapFeeRate > 0 && newSwapFeeRate <= 1000, "Invalid swap fee rate"); // Max 10%
        require(newLpSharePercent > 0 && newLpSharePercent <= 10000, "Invalid LP share percent"); // Max 100%

        swapFeeRate = newSwapFeeRate;
        lpSharePercent = newLpSharePercent;

        emit FeeParametersUpdated(newSwapFeeRate, newLpSharePercent);
    }

    /// @notice Update fee parameters for a specific pool (owner or admin)
    /// @param poolAddress The address of the pool to update
    /// @param newSwapFeeRate New swap fee rate in basis points
    /// @param newLpSharePercent New LP share percentage in basis points
    /// @dev This function allows setting custom fee parameters for individual pools
    /// @dev The pool must be owned by this factory (i.e., created by this factory)
    function setPoolFeeParameters(
        address poolAddress,
        uint256 newSwapFeeRate,
        uint256 newLpSharePercent
    ) external onlyOwner {
        require(poolAddress != address(0), "Zero pool address");
        require(newSwapFeeRate > 0 && newSwapFeeRate <= 1000, "Invalid swap fee rate"); // Max 10%
        require(newLpSharePercent > 0 && newLpSharePercent <= 10000, "Invalid LP share percent"); // Max 100%

        // Verify the pool belongs to this factory
        require(address(Pool(poolAddress).poolFactory()) == address(this), "Pool does not belong to this factory");

        // Call the pool's single setFeeParameters function
        Pool(poolAddress).setFeeParameters(newSwapFeeRate, newLpSharePercent);

        emit PoolFeeParametersUpdated(poolAddress, newSwapFeeRate, newLpSharePercent);
    }

    /// @notice Call sync on all pools or select pools
    /// @param pools Array of pool addresses to sync
    /// @dev If no pools are provided, sync all pools
    /// @dev This function is used to sync the pools after a token transfer
    function syncPools(address[] pools) external onlyOwner {
        address[] memory targetPools = pools;
        if (targetPools.length == 0) {
            targetPools = allPools;
        }
        for (uint256 i = 0; i < targetPools.length; i++) {
            Pool(targetPools[i]).sync();
        }
    }

    /// @notice Call skim on all pools or select pools
    /// @param pools Array of pool addresses to skim
    /// @param to Address to skim the pools to
    /// @dev If no pools are provided, skim all pools
    /// @dev This function is used to skim the pools after a token transfer
    function skimPools(address[] pools, address to) external onlyOwner {
        address[] memory targetPools = pools;
        if (targetPools.length == 0) {
            targetPools = allPools;
        }
        for (uint256 i = 0; i < targetPools.length; i++) {
            Pool(targetPools[i]).skim(to);
        }
    }

    // ============ POOL MANAGEMENT ============

    /// @notice Create a new pool for tokenA/tokenB
    /// @dev After pool creation, the pool should be whitelisted for mint and burn of the LP tokenby the admin registry
    function createPool(address tokenA, address tokenB) external tokensActive(tokenA, tokenB) onlyOwner returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool exists");

        // deploy new lp token
        string lpName = ERC20(tokenA).name() + "-" + ERC20(tokenB).name() + " LP Token";
        string lpSymbol = ERC20(tokenA).symbol() + "-" + ERC20(tokenB).symbol() + "-LP";

        address lpTokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            lpName,
            "Liquidity Provider Token",
            [],
            [],
            [],
            lpSymbol,
            0,
            18,
            this
        );

        // deploy new pool first
        _updatePoolImplementation();
        pool = address(new Proxy(poolImplementation, address(this)));
        Pool(pool).initialize(tokenA, tokenB, lpTokenAddress, address(this));
        address thisOwner = owner();
        Pool(pool).transferOwnership(thisOwner);
        Ownable(lpTokenAddress).transferOwnership(thisOwner);

        // update pool registry
        pools[tokenA][tokenB] = pool;
        pools[tokenB][tokenA] = pool; // support both directions
        allPools.push(pool);

        emit NewPool(tokenA, tokenB, pool);

        return pool;
    }

    /// @notice Create a new pool for tokenA/tokenB
    /// @dev After pool creation, the pool should be whitelisted for mint and burn of the LP tokenby the admin registry
    function createStablePool(address tokenA, address tokenB) external tokensActive(tokenA, tokenB) onlyOwner returns (address pool) {
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(tokenA != tokenB, "Identical addresses");
        require(pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0), "Pool exists");

        // deploy new lp token
        string lpName = ERC20(tokenA).name() + "-" + ERC20(tokenB).name() + " LP Token";
        string lpSymbol = ERC20(tokenA).symbol() + "-" + ERC20(tokenB).symbol() + "-LP";

        address lpTokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            lpName,
            "Liquidity Provider Token",
            [],
            [],
            [],
            lpSymbol,
            0,
            18,
            this
        );

        // deploy new pool first
        _updatePoolImplementation();
        _updateStablePoolImplementation();
        pool = address(new Proxy(poolImplementation, address(this)));
        Pool(pool).setFeeParameters(swapFeeRate, lpSharePercent); // Get StablePool to show up in Pool table
        Proxy(pool).setLogicContract(stablePoolImplementation);
        StablePool(pool).initialize(
            100,
            swapFeeRate * 1e6, // 0.3% * FEE_DENOMINATOR
            1e10,
            block.timestamp,
            [address(tokenA), address(tokenB)],
            [1e18, 1e18],
            [1, 1],
            [address(0), address(0)],
            lpTokenAddress
        );
        address thisOwner = owner();
        Ownable(pool).transferOwnership(thisOwner);
        Ownable(lpTokenAddress).transferOwnership(thisOwner);

        // update pool registry
        pools[tokenA][tokenB] = pool;
        pools[tokenB][tokenA] = pool; // support both directions
        allPools.push(pool);

        emit NewPool(tokenA, tokenB, pool);

        return pool;
    }

    /// @notice Create a new pool for multiple tokens
    /// @dev After pool creation, the pool should be whitelisted for mint and burn of the LP tokenby the admin registry
    function createMultiTokenStablePool(
        address[] tokens,
        uint[] rateMultipliers,
        uint[] assetTypes,
        address[] oracles
    ) external onlyOwner returns (address pool) {
        for (uint i = 0; i < tokens.length; i++) {
            require(TokenFactory(tokenFactory).isTokenActive(tokens[i]), "Token not active");
            require(tokens[i] != address(0), "Zero address");
            for (uint j = 0; j < tokens.length; j++) {
                if (i != j) {
                    require(tokens[i] != tokens[j], "Identical addresses");
                    // require(pools[tokens[i]][tokens[j]] == address(0), "Pool exists");
                }
            }
        }

        // deploy new lp token
        string lpName = ERC20(tokens[0]).name() + "Multi-Token Stable LP Token";
        string lpSymbol = ERC20(tokens[0]).symbol() + "-MTSLP";

        address lpTokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            lpName,
            "Liquidity Provider Token",
            [],
            [],
            [],
            lpSymbol,
            0,
            18,
            this
        );

        // deploy new pool first
        _updatePoolImplementation();
        _updateStablePoolImplementation();
        pool = address(new Proxy(poolImplementation, address(this)));
        Pool(pool).setFeeParameters(swapFeeRate, lpSharePercent); // Get StablePool to show up in Pool table
        Proxy(pool).setLogicContract(stablePoolImplementation);
        StablePool(pool).initialize(
            100,
            swapFeeRate * 1e6, // 0.3% * FEE_DENOMINATOR
            1e10,
            block.timestamp,
            tokens,
            rateMultipliers,
            assetTypes,
            oracles,
            lpTokenAddress
        );
        address thisOwner = owner();
        Ownable(pool).transferOwnership(thisOwner);
        Ownable(lpTokenAddress).transferOwnership(thisOwner);

        for (uint i = 0; i < tokens.length; i++) {
            for (uint j = 0; j < tokens.length; j++) {
                if (i != j) {
                    // update pool registry
                    // pools[tokens[i]][tokens[j]] = pool;

                    emit NewPool(tokens[i], tokens[j], pool);
                }
            }
        }
        allPools.push(pool);

        return pool;
    }

    /// @notice Transfer all pools to a new factory
    /// @param newFactory Address of the new factory
    function transferPoolsToFactory(address newFactory) external onlyOwner {
        for (uint256 i = 0; i < allPools.length; i++) {
            address pool = allPools[i];
            if (pool != address(0)) {
                // Transfer pool to new factory
                Pool(pool).transferPoolToFactory(newFactory);
            }
        }
        emit PoolsMigrated(address(this), newFactory, allPools.length);
    }

    /// @notice Register pools received from another factory
    /// @param poolAddresses Array of pool addresses to register
    function registerPoolsFromFactory(address[] poolAddresses) external onlyOwner {
        for (uint256 i = 0; i < poolAddresses.length; i++) {
            address pool = poolAddresses[i];

            // Verify the pool belongs to this factory
            require(address(Pool(pool).poolFactory()) == address(this), "Pool does not belong to this factory");

            // Get tokenA and tokenB from the pool contract
            Pool poolContract = Pool(pool);
            address tokenA = address(poolContract.tokenA());
            address tokenB = address(poolContract.tokenB());

            // Only register if pool doesn't already exist
            if (pools[tokenA][tokenB] == address(0) && pools[tokenB][tokenA] == address(0)) {
                pools[tokenA][tokenB] = pool;
                pools[tokenB][tokenA] = pool;
                allPools.push(pool);
            }
        }
        emit PoolsMigrated(address(0), address(this), poolAddresses.length);
    }

    /// @notice Merge multiple StablePool instances into a single multi-token StablePool
    /// @param poolAddresses Array of StablePool addresses to merge
    /// @param allLpHolders Flat array of all LP holder addresses across all pools, concatenated in pool order
    /// @param holdersPerPool Array where holdersPerPool[i] is the number of LP holders for pool i
    /// @return newPool The address of the newly created merged pool
    /// @dev After calling this function, the admin must whitelist the new pool for mint/burn
    ///      on the new LP token via the AdminRegistry, just as with any new pool creation.
    ///      Old pools will be drained but not disabled - the admin should disable them separately.
    function mergeStablePools(
        address[] poolAddresses,
        address[] allLpHolders,
        uint[] holdersPerPool
    ) external onlyOwner returns (address newPool) {
        require(poolAddresses.length >= 2, "Need at least 2 pools to merge");
        require(poolAddresses.length == holdersPerPool.length, "Mismatched array lengths");

        // Validate that holdersPerPool sums to allLpHolders.length
        uint totalHolders = 0;
        for (uint i = 0; i < holdersPerPool.length; i++) {
            totalHolders += holdersPerPool[i];
        }
        require(totalHolders == allLpHolders.length, "holdersPerPool sum does not match allLpHolders length");

        // 1. Collect all unique tokens and their properties from the pools being merged
        address[] uniqueTokens;
        uint[] uniqueRateMultipliers;
        uint[] uniqueAssetTypes;
        address[] uniqueOracles;

        for (uint i = 0; i < poolAddresses.length; i++) {
            StablePool pool = StablePool(poolAddresses[i]);
            require(StablePool(poolAddresses[i]).getPoolFactory() == address(this), "Pool does not belong to this factory");

            uint numCoins = pool.getNumCoins();
            for (uint j = 0; j < numCoins; j++) {
                address tokenAddr = address(pool.coins(j));
                bool found = false;
                for (uint k = 0; k < uniqueTokens.length; k++) {
                    if (uniqueTokens[k] == tokenAddr) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    uniqueTokens.push(tokenAddr);
                    uniqueRateMultipliers.push(pool.rateMultipliers(tokenAddr));
                    uniqueAssetTypes.push(pool.getAssetType(j));
                    uniqueOracles.push(address(pool.rateOracles(tokenAddr)));
                }
            }
        }

        require(uniqueTokens.length >= 2, "Need at least 2 unique tokens");
        require(uniqueTokens.length <= 8, "Too many unique tokens (max 8)");

        // 2. Calculate each pool's value contribution BEFORE draining
        //    Value is measured as the sum of user token balances weighted by rate multipliers
        uint[] poolValues;
        uint totalValue = 0;

        for (uint i = 0; i < poolAddresses.length; i++) {
            StablePool pool = StablePool(poolAddresses[i]);
            uint numCoins = pool.getNumCoins();
            uint value = 0;

            for (uint j = 0; j < numCoins; j++) {
                address tokenAddr = address(pool.coins(j));
                uint userBalance = pool.tokenBalances(tokenAddr) - pool.adminBalances(tokenAddr);
                // Use the new pool's rate multiplier for consistent cross-pool comparison
                for (uint k = 0; k < uniqueTokens.length; k++) {
                    if (uniqueTokens[k] == tokenAddr) {
                        value += (userBalance * uniqueRateMultipliers[k]) / 1e18;
                        break;
                    }
                }
            }

            require(value > 0, "Pool has no value to migrate");
            poolValues.push(value);
            totalValue += value;
        }

        // 3. Create the new multi-token stable pool
        //    LP token ownership is kept at this factory so we can mint LP tokens directly
        string lpName = "Merged Stable LP Token";
        string lpSymbol = "MSLP";

        address lpTokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            lpName,
            "Liquidity Provider Token",
            [],
            [],
            [],
            lpSymbol,
            0,
            18,
            this
        );

        _updatePoolImplementation();
        _updateStablePoolImplementation();
        newPool = address(new Proxy(poolImplementation, address(this)));
        Pool(newPool).setFeeParameters(swapFeeRate, lpSharePercent);
        Proxy(newPool).setLogicContract(stablePoolImplementation);
        StablePool(newPool).initialize(
            100,
            swapFeeRate * 1e6,
            1e10,
            block.timestamp,
            uniqueTokens,
            uniqueRateMultipliers,
            uniqueAssetTypes,
            uniqueOracles,
            lpTokenAddress
        );

        address thisOwner = owner();
        Ownable(newPool).transferOwnership(thisOwner);
        // NOTE: LP token ownership is NOT transferred yet - factory needs it to mint

        // 4. Drain all old pools and transfer tokens to the new pool
        for (uint i = 0; i < poolAddresses.length; i++) {
            StablePool(poolAddresses[i]).migrateAllTokens(address(this));
        }

        for (uint t = 0; t < uniqueTokens.length; t++) {
            uint balance = ERC20(uniqueTokens[t]).balanceOf(address(this));
            if (balance > 0) {
                ERC20(uniqueTokens[t]).transfer(newPool, balance);
            }
        }

        // 5. Sync the new pool's internal state with the received tokens
        StablePool(newPool).syncAfterMigration();

        // 6. Calculate total LP supply using the D invariant of the new pool
        //    This matches the behavior of addLiquidityGeneral for the first deposit
        uint totalNewLP = StablePool(newPool).computeInvariant();
        require(totalNewLP > 0, "New pool invariant is zero");

        // 7. Mint new LP tokens to old LP holders proportionally
        //    Each pool gets a share of new LP tokens based on its value contribution.
        //    Within each pool, LP tokens are distributed proportional to old LP balances.
        uint holderOffset = 0;
        for (uint i = 0; i < poolAddresses.length; i++) {
            StablePool pool = StablePool(poolAddresses[i]);
            Token oldLpToken = pool.lpToken();
            uint oldTotalSupply = oldLpToken.totalSupply();
            require(oldTotalSupply > 0, "Pool has no LP tokens");

            uint poolLPShare = (totalNewLP * poolValues[i]) / totalValue;

            for (uint h = 0; h < holdersPerPool[i]; h++) {
                address holder = allLpHolders[holderOffset + h];
                uint holderBalance = oldLpToken.balanceOf(holder);
                if (holderBalance > 0) {
                    uint holderNewLP = (poolLPShare * holderBalance) / oldTotalSupply;
                    if (holderNewLP > 0) {
                        Token(lpTokenAddress).mint(holder, holderNewLP);
                    }
                }
            }
            holderOffset += holdersPerPool[i];
        }

        // 8. Transfer LP token ownership to admin (same pattern as createMultiTokenStablePool)
        Ownable(lpTokenAddress).transferOwnership(thisOwner);

        // 9. Clear old pool entries from the pools mapping and allPools array
        for (uint i = 0; i < poolAddresses.length; i++) {
            StablePool pool = StablePool(poolAddresses[i]);
            uint numCoins = pool.getNumCoins();
            for (uint j = 0; j < numCoins; j++) {
                for (uint k = j + 1; k < numCoins; k++) {
                    address tokenJ = address(pool.coins(j));
                    address tokenK = address(pool.coins(k));
                    if (pools[tokenJ][tokenK] == poolAddresses[i]) {
                        pools[tokenJ][tokenK] = address(0);
                    }
                    if (pools[tokenK][tokenJ] == poolAddresses[i]) {
                        pools[tokenK][tokenJ] = address(0);
                    }
                }
            }
            // Remove from allPools by swapping with last element
            for (uint a = 0; a < allPools.length; a++) {
                if (allPools[a] == poolAddresses[i]) {
                    allPools[a] = allPools[allPools.length - 1];
                    allPools[allPools.length - 1] = address(0);
                    allPools.length--;
                    break;
                }
            }
        }

        // 10. Register the new pool in the pools mapping and allPools array
        for (uint i = 0; i < uniqueTokens.length; i++) {
            for (uint j = 0; j < uniqueTokens.length; j++) {
                if (i != j) {
                    pools[uniqueTokens[i]][uniqueTokens[j]] = newPool;
                    pools[uniqueTokens[j]][uniqueTokens[i]] = newPool;
                    if (i < j) {
                        emit NewPool(uniqueTokens[i], uniqueTokens[j], newPool);
                    }
                }
            }
        }
        allPools.push(newPool);

        emit PoolsMerged(poolAddresses, newPool);

        return newPool;
    }

    function updatePoolImplementation() external onlyOwner {
        _updatePoolImplementation();
    }

    function _updatePoolImplementation() internal {
        address thisOwner = owner();
        poolImplementation = address(new Pool(address(thisOwner)));
    }

    function updateStablePoolImplementation() external onlyOwner {
        _updateStablePoolImplementation();
    }

    function _updateStablePoolImplementation() internal {
        address thisOwner = owner();
        stablePoolImplementation = address(new StablePool(address(thisOwner)));
    }
}
