/**
 * @title VaultFactory
 * @notice Factory pattern contract that standardizes vault creation and tracking
 * @dev While vaults are created here, users interact directly with vault contracts after creation
 *
 * The factory serves three main purposes:
 * 1. Standardized vault creation (owner only)
 * 2. Vault registry - lookup existing vaults by name or address
 * 3. Vault tracking - maintain list of all created vaults
 */

import "Vault.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Proxy/Proxy.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";
import "../Lending/PriceOracle.sol";

/// @notice Vault factory contract
contract record VaultFactory is Ownable {

    // ============ EVENTS ============

    /// @notice Event emitted when a new vault is created
    event NewVault(string name, string symbol, address vault);

    /// @notice Event emitted when vaults are migrated
    event VaultsMigrated(address oldFactory, address newFactory, uint256 vaultCount);

    /// @notice Event emitted when the admin registry is updated
    event AdminRegistryUpdated(address newRegistry);

    /// @notice Event emitted when the token factory is updated
    event TokenFactoryUpdated(address newFactory);

    /// @notice Event emitted when the price oracle is updated
    event PriceOracleUpdated(address newOracle);

    /// @notice Event emitted when the default bot executor is updated
    event DefaultBotExecutorUpdated(address newBotExecutor);

    // ============ STATE VARIABLES ============

    /// @notice Mapping of vault name to vault address
    mapping(string => address) public record vaultsByName;

    /// @notice Array of all vault addresses
    address[] public record allVaults;

    /// @notice Admin registry contract address
    address public adminRegistry;

    /// @notice Token factory contract address
    address public tokenFactory;

    /// @notice Price oracle contract address
    address public priceOracle;

    /// @notice Default bot executor address for new vaults
    address public defaultBotExecutor;

    /// @notice Vault implementation address for proxy pattern
    address public vaultImplementation;

    // ============ CONSTRUCTOR ============

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Initialize the contract
    /// @param _tokenFactory The address of the token factory
    /// @param _priceOracle The address of the price oracle
    /// @param _adminRegistry The address of the admin registry
    /// @param _defaultBotExecutor The default bot executor for new vaults
    function initialize(
        address _tokenFactory,
        address _priceOracle,
        address _adminRegistry,
        address _defaultBotExecutor
    ) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        require(_tokenFactory != address(0), "Zero token factory address");
        require(_priceOracle != address(0), "Zero price oracle address");
        require(_defaultBotExecutor != address(0), "Zero bot executor address");

        adminRegistry = _adminRegistry;
        tokenFactory = _tokenFactory;
        priceOracle = _priceOracle;
        defaultBotExecutor = _defaultBotExecutor;

        emit AdminRegistryUpdated(adminRegistry);
        emit TokenFactoryUpdated(tokenFactory);
        emit PriceOracleUpdated(priceOracle);
        emit DefaultBotExecutorUpdated(defaultBotExecutor);
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Update the admin registry address (owner only)
    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        adminRegistry = _adminRegistry;
        emit AdminRegistryUpdated(_adminRegistry);
    }

    /// @notice Update the token factory address (owner only)
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        require(_tokenFactory != address(0), "Zero token factory address");
        tokenFactory = _tokenFactory;
        emit TokenFactoryUpdated(_tokenFactory);
    }

    /// @notice Update the price oracle address (owner only)
    function setPriceOracle(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "Zero price oracle address");
        priceOracle = _priceOracle;
        emit PriceOracleUpdated(_priceOracle);
    }

    /// @notice Update the default bot executor address (owner only)
    function setDefaultBotExecutor(address _defaultBotExecutor) external onlyOwner {
        require(_defaultBotExecutor != address(0), "Zero bot executor address");
        defaultBotExecutor = _defaultBotExecutor;
        emit DefaultBotExecutorUpdated(_defaultBotExecutor);
    }

    // ============ VAULT MANAGEMENT ============

    /// @notice Create a new vault
    /// @param name Name for the vault share token (e.g., "Mercata Arbitrage Vault")
    /// @param symbol Symbol for the vault share token (e.g., "vSHARE")
    /// @return vault Address of the newly created vault
    function createVault(
        string name,
        string symbol
    ) external onlyOwner returns (address vault) {
        require(vaultsByName[name] == address(0), "Vault name exists");

        // Deploy new vault implementation if needed
        _updateVaultImplementation();

        // Create vault via proxy pattern
        vault = address(new Proxy(vaultImplementation, address(this)));

        // Create share token via TokenFactory (owned by factory initially)
        address shareTokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            name,
            "Vault share token representing proportional ownership of vault equity",
            [],
            [],
            [],
            symbol,
            0,  // Initial supply = 0
            18, // 18 decimals
            this
        );

        // Initialize the vault with the share token
        Vault(vault).initialize(
            priceOracle,
            defaultBotExecutor,
            shareTokenAddress
        );

        // Transfer ownership to factory owner
        address thisOwner = owner();
        Vault(vault).transferOwnership(thisOwner);
        Ownable(shareTokenAddress).transferOwnership(thisOwner);

        // Register vault
        vaultsByName[name] = vault;
        allVaults.push(vault);

        emit NewVault(name, symbol, vault);

        return vault;
    }

    /// @notice Create a new vault with custom bot executor
    /// @param name Name for the vault share token
    /// @param symbol Symbol for the vault share token
    /// @param botExecutor Custom bot executor address for this vault
    /// @return vault Address of the newly created vault
    function createVaultWithBotExecutor(
        string name,
        string symbol,
        address botExecutor
    ) external onlyOwner returns (address vault) {
        require(vaultsByName[name] == address(0), "Vault name exists");
        require(botExecutor != address(0), "Zero bot executor address");

        // Deploy new vault implementation if needed
        _updateVaultImplementation();

        // Create vault via proxy pattern
        vault = address(new Proxy(vaultImplementation, address(this)));

        // Create share token via TokenFactory (owned by factory initially)
        address shareTokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            name,
            "Vault share token representing proportional ownership of vault equity",
            [],
            [],
            [],
            symbol,
            0,  // Initial supply = 0
            18, // 18 decimals
            this
        );

        // Initialize the vault with custom bot executor
        Vault(vault).initialize(
            priceOracle,
            botExecutor,
            shareTokenAddress
        );

        // Transfer ownership to factory owner
        address thisOwner = owner();
        Vault(vault).transferOwnership(thisOwner);
        Ownable(shareTokenAddress).transferOwnership(thisOwner);

        // Register vault
        vaultsByName[name] = vault;
        allVaults.push(vault);

        emit NewVault(name, symbol, vault);

        return vault;
    }

    /// @notice Get a vault by its name
    /// @param name Name of the vault
    /// @return vault Address of the vault
    function getVault(string name) external view returns (address vault) {
        return vaultsByName[name];
    }

    /// @notice Get the number of vaults
    /// @return count Number of vaults
    function getVaultCount() external view returns (uint256 count) {
        return allVaults.length;
    }

    /// @notice Get all vault addresses
    /// @return vaults Array of all vault addresses
    function getAllVaults() external view returns (address[] memory vaults) {
        return allVaults;
    }


    // ============ MIGRATION FUNCTIONS ============

    /// @notice Register vaults received from another factory
    /// @param vaultAddresses Array of vault addresses to register
    /// @param vaultNames Array of vault names corresponding to addresses
    function registerVaultsFromFactory(address[] vaultAddresses, string[] vaultNames) external onlyOwner {
        require(vaultAddresses.length == vaultNames.length, "Array length mismatch");

        for (uint256 i = 0; i < vaultAddresses.length; i++) {
            address vault = vaultAddresses[i];
            string memory name = vaultNames[i];

            // Only register if vault doesn't already exist
            if (vaultsByName[name] == address(0)) {
                vaultsByName[name] = vault;
                allVaults.push(vault);
            }
        }

        emit VaultsMigrated(address(0), address(this), vaultAddresses.length);
    }

    // ============ IMPLEMENTATION MANAGEMENT ============

    /// @notice Update the vault implementation (owner only)
    function updateVaultImplementation() external onlyOwner {
        _updateVaultImplementation();
    }

    /// @notice Internal function to update vault implementation
    function _updateVaultImplementation() internal {
        address thisOwner = owner();
        vaultImplementation = address(new Vault(address(thisOwner)));
    }

}
