import "../../abstract/ERC20/access/Ownable.sol";
import "../Tokens/TokenFactory.sol";
import "../Pools/PoolFactory.sol";
import "../Lending/PoolConfigurator.sol";

/**
 * @title AdminRegistry
 * @notice Centralized registry of trusted admin accounts used for access control across system contracts.
 */
contract AdminRegistry is Ownable {
    mapping(address => bool) public isAdmin;
    address public tokenFactory; // Store token factory address for token status checks
    address public poolConfigurator; // Store pool configurator address for updates
    
    event AdminAdded(address admin);
    event AdminRemoved(address admin);
    event FactoryMigrated(address oldFactory, address newFactory, FactoryType factoryType, uint256 migratedCount);
    event TokenFactoryUpdated(address oldFactory, address newFactory);
    event PoolConfiguratorUpdated(address oldConfigurator, address newConfigurator);
    
    enum FactoryType { TOKEN, POOL }
    
    /**
     * @notice Initializes the registry and sets the initial owner and admin.
     * @param _owner The address to be set as the contract owner and initial admin.
     */
    constructor(address _owner) {
        require(_owner != address(0), "AdminRegistry: owner is zero address");
        _transferOwnership(_owner);
        isAdmin[_owner] = true;
        emit AdminAdded(_owner);
    }
    
    /**
     * @notice Adds an admin account. Only callable by the contract owner.
     * @param admin The address to grant admin access to.
     */
    function addAdmin(address admin) external onlyOwner {
        require(admin != address(0), "AdminRegistry: cannot add zero address");
        require(!isAdmin[admin], "AdminRegistry: already admin");
        isAdmin[admin] = true;
        emit AdminAdded(admin);
    }
    
    /**
     * @notice Removes an admin account. Only callable by the contract owner.
     * @param admin The address to remove from the admin list.
     */
    function removeAdmin(address admin) external onlyOwner {
        require(isAdmin[admin], "AdminRegistry: not an admin");
        isAdmin[admin] = false;
        emit AdminRemoved(admin);
    }
    
    /**
     * @notice Public check for admin status (optional; same as the mapping getter).
     * @param admin The address to check.
     * @return True if the address is an admin.
     */
    function isAdminAddress(address admin) external view returns (bool) {
        return isAdmin[admin];
    }
    
    /**
     * @notice Set the token factory address for token status checks.
     * @param _tokenFactory The address of the token factory.
     */
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        require(_tokenFactory != address(0), "AdminRegistry: token factory is zero address");
        address oldFactory = tokenFactory;
        tokenFactory = _tokenFactory;
        emit TokenFactoryUpdated(oldFactory, _tokenFactory);
    }
    
    /**
     * @notice Set the pool configurator address for updates.
     * @param _poolConfigurator The address of the pool configurator.
     */
    function setPoolConfigurator(address _poolConfigurator) external onlyOwner {
        address oldConfigurator = poolConfigurator;
        poolConfigurator = _poolConfigurator;
        emit PoolConfiguratorUpdated(oldConfigurator, _poolConfigurator);
    }
    
    /**
     * @notice Migrate factory from old address to new address.
     * @param oldFactory The address of the old factory.
     * @param newFactory The address of the new factory.
     * @param factoryType The type of factory (TOKEN or POOL).
     */
    function migrateFactory(
        address oldFactory, 
        address newFactory, 
        FactoryType factoryType
    ) external onlyOwner {
        require(oldFactory != address(0), "AdminRegistry: old factory is zero address");
        require(newFactory != address(0), "AdminRegistry: new factory is zero address");
        require(oldFactory != newFactory, "AdminRegistry: old and new factory are the same");
        
        if (factoryType == FactoryType.TOKEN) {
            // Get all tokens from old factory
            address[] tokens = TokenFactory(oldFactory).allTokens();
            
            // Migrate tokens to new factory
            TokenFactory(oldFactory).migrateTokensToFactory(newFactory, tokens);
            
            // Register tokens in new factory
            TokenFactory(newFactory).registerMigratedTokens(tokens);
            
            // Update the token factory reference if it was pointing to the old factory
            if (tokenFactory == oldFactory) {
                tokenFactory = newFactory;
                emit TokenFactoryUpdated(oldFactory, newFactory);
            }
            
            // Update pool configurator token factory reference if it exists
            if (poolConfigurator != address(0)) {
                PoolConfigurator(poolConfigurator).setTokenFactory(newFactory);
            }
            
            emit FactoryMigrated(oldFactory, newFactory, FactoryType.TOKEN, tokens.length);
            
        } else if (factoryType == FactoryType.POOL) {
            // Get all pools from old factory
            address[] pools = PoolFactory(oldFactory).allPools();
            
            // Register pools in new factory
            PoolFactory(newFactory).registerMigratedPools(pools);
            
            emit FactoryMigrated(oldFactory, newFactory, FactoryType.POOL, pools.length);
        }
    }
}