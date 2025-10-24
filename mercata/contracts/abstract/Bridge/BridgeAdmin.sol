import "../../abstract/ERC20/access/Ownable.sol";
import "./BridgeRegistry.sol";

/**
 * @title BridgeAdmin
 * @dev Abstract contract providing administrative functions for bridge operations
 * @notice Manages bridge configuration, access control, and emergency functions
 * @notice Extends BridgeRegistry with owner-only administrative capabilities
 */
abstract contract BridgeAdmin is BridgeRegistry, Ownable {

    /// @notice Decimal places for token amounts
    /// @dev Default: 18
    uint256 public DECIMAL_PLACES = 18;

    /// @notice Circuit breaker for deposit operations
    /// @dev When true, all deposit operations are paused
    bool public depositsPaused;
    
    /// @notice Off-chain orchestrator account responsible for bridge operations
    /// @dev Only this address can update last processed blocks
    address public relayer;
    
    /// @notice Token factory contract for creating new STRATO tokens
    /// @dev Single source of truth for active token creation
    address public tokenFactory;
    
    /// @notice USDST token address for cross-chain minting/redeeming
    /// @dev Default USDST address: 0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010
    address public USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
    
    /// @notice Circuit breaker for withdrawal operations
    /// @dev When true, all withdrawal operations are paused
    bool public withdrawalsPaused;
    
    /// @notice Time delay before users can abort stuck withdrawals
    /// @dev Default: 172800 seconds (48 hours)
    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;

    /// @notice Emitted when pause states are toggled for deposits and withdrawals
    event PauseToggled(bool depositsPaused, bool withdrawalsPaused);
    
    /// @notice Emitted when the relayer address is updated
    event RelayerUpdated(address newRelayer, address oldRelayer);
    
    /// @notice Emitted when the token factory address is updated
    event TokenFactoryUpdated(address newFactory, address oldFactory);
    
    /// @notice Emitted when the USDST address is updated
    event USDSTAddressUpdated(address newAddress, address oldAddress);
    
    /// @notice Emitted when a chain's enabled state is toggled
    event ChainToggled(bool enabled, uint256 externalChainId);
    
    /// @notice Emitted when an asset's enabled state is toggled
    event AssetToggled(bool enabled, uint256 externalChainId, address externalToken);

    /// @notice Restricts access to the relayer address only
    /// @dev Ensures only the designated relayer can perform certain operations
    modifier onlyRelayer() {
        require(msg.sender == relayer, "MB: relayer only");
        _;
    }

    /// @notice Ensures deposits are not paused
    /// @dev Prevents deposit operations when circuit breaker is active
    modifier whenDepositsOpen() {
        require(!depositsPaused, "MB: deposits paused");
        _;
    }

    /// @notice Ensures withdrawals are not paused
    /// @dev Prevents withdrawal operations when circuit breaker is active
    modifier whenWithdrawalsOpen() {
        require(!withdrawalsPaused, "MB: withdrawals paused");
        _;
    }

    /**
    * @dev Initializes the contract with the specified owner
    * @notice Sets up the bridge admin contract with ownership and access control
    * @param _owner The address that will be set as the contract owner
    */
    constructor(address _owner) Ownable(_owner) {}

    /**
     * @dev Emergency function to set the last processed block for a chain
     * @notice Allows rollback of block processing state in emergency situations
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The block number to set as last processed
     */
    function emergencySetLastProcessedBlock(
        uint256 externalChainId, 
        uint256 lastProcessedBlock
    ) external onlyOwner {
        _emergencySetLastProcessedBlock(externalChainId, lastProcessedBlock);
    }

    /**
     * @dev Sets asset configuration for a specific external chain
     * @notice Maps external tokens to their STRATO equivalents with withdrawal limits
     * @param externalChainId The external chain identifier
     * @param externalDecimals The number of decimals for the external token
     * @param externalName The name of the external token
     * @param externalSymbol The symbol of the external token
     * @param externalToken The address of the external token contract
     * @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
     * @param stratoToken The corresponding STRATO token address
     * @param enabled Whether the asset is enabled for bridge operations
     */
    function setAsset(
        uint256 externalChainId,
        uint256 externalDecimals,
        string externalName,
        string externalSymbol,
        address externalToken,
        uint256 maxPerWithdrawal,
        address stratoToken,
        bool enabled
    ) external onlyOwner {
        _setAsset(externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken, enabled);
    }

    /**
     * @dev Sets chain configuration for bridge operations
     * @notice Configures external chain parameters including custody and router addresses
     * @param chainName The human-readable name of the external chain
     * @param custody The custody contract address on the external chain
     * @param enabled Whether the chain is enabled for bridge operations
     * @param externalChainId The unique identifier for the external chain
     * @param lastProcessedBlock The last processed block number for this chain
     * @param router The router contract address for deposits
     */
    function setChain(
        string chainName,
        address custody,
        bool enabled,
        uint256 externalChainId,
        uint256 lastProcessedBlock,
        address router
    ) external onlyOwner {
        _setChain(chainName, custody, enabled, externalChainId, lastProcessedBlock, router);
    }

    /**
     * @dev Updates the last processed block for a specific chain
     * @notice Prevents rollback attacks by ensuring block numbers only increase
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The new last processed block number
     */
    function setLastProcessedBlock(uint256 externalChainId, uint256 lastProcessedBlock) external onlyRelayer {
        _setLastProcessedBlock(externalChainId, lastProcessedBlock);
    }

    /**
     * @dev Sets pause states for deposits and withdrawals
     * @notice Circuit breaker functionality to pause bridge operations
     * @param _deposits Whether to pause deposit operations
     * @param _withdrawals Whether to pause withdrawal operations
     */
    function setPause(bool _deposits, bool _withdrawals) external onlyOwner {
        depositsPaused    = _deposits;
        withdrawalsPaused = _withdrawals;
        emit PauseToggled(_deposits, _withdrawals);
    }

    /**
     * @dev Sets the relayer address
     * @notice Only the owner can update the relayer address
     * @param newRelayer The new relayer address (must not be zero address)
     */
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "BA: zero");
        emit RelayerUpdated(newRelayer, relayer);
        relayer = newRelayer;
    }

    /**
     * @dev Sets the token factory address
     * @notice Only the owner can update the token factory address
     * @param newFactory The new token factory address (must not be zero address)
     */
    function setTokenFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "BA: zero");
        emit TokenFactoryUpdated(newFactory, tokenFactory);
        tokenFactory = newFactory;
    }

    /**
     * @dev Sets the USDST token address
     * @notice Only the owner can update the USDST address
     * @param newUSDSTAddress The new USDST token address (must not be zero address)
     */
    function setUSDSTAddress(address newUSDSTAddress) external onlyOwner {
        require(newUSDSTAddress != address(0), "BA: zero USDST address");
        emit USDSTAddressUpdated(newUSDSTAddress, USDST_ADDRESS);
        USDST_ADDRESS = newUSDSTAddress;
    }

    /**
     * @dev Toggles the enabled state of a chain
     * @notice Only the owner can enable/disable chains
     * @param externalChainId The external chain identifier
     * @param enabled Whether to enable or disable the chain
     */
    function toggleChain(uint256 externalChainId, bool enabled) external onlyOwner {
        require(externalChainId > 0, "BA: invalid chain id");
        require(chains[externalChainId].custody != address(0), "BA: chain not found");
        
        chains[externalChainId].enabled = enabled;
        emit ChainToggled(enabled, externalChainId);
    }

    /**
     * @dev Toggles the enabled state of an asset
     * @notice Only the owner can enable/disable assets
     * @param externalToken The external token address
     * @param externalChainId The external chain identifier
     * @param enabled Whether to enable or disable the asset
     */
    function toggleAsset(address externalToken, uint256 externalChainId, bool enabled) external onlyOwner {
        require(externalChainId > 0, "BA: invalid chain id");
        require(assets[externalToken][externalChainId].externalChainId == externalChainId, "BA: asset not found");
        
        assets[externalToken][externalChainId].enabled = enabled;
        emit AssetToggled(enabled, externalChainId, externalToken);
    }
}