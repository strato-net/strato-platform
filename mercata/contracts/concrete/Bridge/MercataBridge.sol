import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";
import "../Admin/AdminRegistry.sol";
import "../../libraries/Bridge/BridgeTypes.sol";
import "../Lending/LendingRegistry.sol";

/**
 * @title MercataBridge
 * @dev Complete bridge system for STRATO <-> External EVM value tunnel
 * @notice Manages deposit and withdrawal workflows with decimal conversion
 * @notice Implements the core logic for cross-chain token bridging
 * @notice Supports multiple external chains and token configurations
 */
contract record MercataBridge is Ownable {
    /// @notice Enables BridgeTypes library functions for all types
    /// @dev Allows direct access to BridgeTypes utility functions without explicit library calls
    using BridgeTypes for *;
    using StringUtils for string;

    /* ===================================================================== */
    /*                                EVENTS                                 */
    /* ===================================================================== */

    // ───────────── Admin related events ─────────────
    /// @notice Emitted when pause states are toggled for deposits and withdrawals
    event PauseToggled(bool depositsPaused, bool withdrawalsPaused);
    
    /// @notice Emitted when the token factory address is updated
    event TokenFactoryUpdated(address newFactory, address oldFactory);

    /// @notice Emitted when the lending registry address is updated
    event LendingRegistryUpdated(address newRegistry, address oldRegistry);
    
    /// @notice Emitted when the USDST address is updated
    event USDSTAddressUpdated(address newAddress, address oldAddress);
    
    /// @notice Emitted when a chain's enabled state is toggled
    event ChainToggled(bool enabled, uint256 externalChainId);
    
    /// @notice Emitted when an asset's enabled state is toggled
    event AssetToggled(bool enabled, uint256 externalChainId, address externalToken);

    // ───────────── Deposit & withdrawal related events ─────────────
    /// @notice Emitted when a deposit is aborted by the owner
    event DepositAborted(uint256 srcChainId, string srcTxHash);
    
    /// @notice Emitted when a deposit is completed and tokens are minted
    event DepositCompleted(uint256 srcChainId, string srcTxHash);
    
    /// @notice Emitted when a deposit is initiated
    /// @param externalChainId The external chain identifier where the deposit occurred
    /// @param externalSender The address that sent the transaction on the external chain
    /// @param externalTxHash The transaction hash on the external chain
    /// @param stratoRecipient The STRATO address to receive the minted tokens
    /// @param stratoToken The STRATO token address that will be minted
    /// @param stratoTokenAmount The amount of STRATO tokens to be minted
    event DepositInitiated(uint256 externalChainId, address externalSender, string externalTxHash, address stratoRecipient, address stratoToken, uint256 stratoTokenAmount);
    
    /// @notice Emitted when a deposit requires manual review
    event DepositPendingReview(uint256 srcChainId, string srcTxHash);
    
    /// @notice Emitted when a withdrawal is aborted and funds are refunded
    event WithdrawalAborted(uint256 withdrawalId);
    
    /// @notice Emitted when a withdrawal is completed and tokens are burned
    event WithdrawalCompleted(uint256 withdrawalId);
    
    /// @notice Emitted when a withdrawal is pending custody transaction
    event WithdrawalPending(string custodyTxHash, uint256 withdrawalId);
    
    /// @notice Emitted when a user requests a withdrawal
    /// @param dest The external recipient address on the destination chain
    /// @param destChainId The external chain identifier where tokens should be sent
    /// @param externalTokenAmount The amount of external tokens to be sent
    /// @param stratoTokenAmount The amount of STRATO tokens escrowed
    /// @param token The STRATO token address that was escrowed
    /// @param user The address that requested the withdrawal
    /// @param withdrawalId The unique withdrawal identifier
    event WithdrawalRequested(address dest, uint256 destChainId, uint256 externalTokenAmount, uint256 stratoTokenAmount, address token, address user, uint256 withdrawalId);

    // ───────────── Registry related events ─────────────
    /// @notice Emitted when chain configuration is updated
    event ChainUpdated(string chainName, address custody, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router);
    
    /// @notice Emitted when the last processed block is updated for a chain
    event LastProcessedBlockUpdated(uint256 externalChainId, uint256 lastProcessedBlock);
    
    /// @notice Emitted during emergency block rollback operations
    event EmergencyBlockRollback(uint256 externalChainId, uint256 lastProcessedBlock);
    
    /// @notice Emitted when asset configuration is updated for a chain
    /// @param enabled Whether the asset is enabled for bridge operations
    /// @param externalChainId The external chain identifier
    /// @param externalDecimals The number of decimals for the external token
    /// @param externalName The name of the external token
    /// @param externalSymbol The symbol of the external token
    /// @param externalToken The address of the external token contract
    /// @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
    /// @param stratoToken The corresponding STRATO token address
    event AssetUpdated(bool enabled, uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken);

    /// @notice Emitted when a user requests to auto save a deposit to the lending pool
    /// @param user The address that requested the auto save
    /// @param externalChainId The external chain identifier where the deposit occurred
    /// @param externalTxHash The transaction hash on the external chain
    event AutoSaveRequested(address user, uint256 externalChainId, string externalTxHash);

    /// @notice Emitted when a deposit is auto saved to the lending pool
    /// @param externalChainId The external chain identifier where the deposit occurred
    /// @param externalTxHash The transaction hash on the external chain
    /// @param mintedAmount The amount of USDST minted and supplied as liquidity
    /// @param mTokenAmount The amount of mUSDST LP tokens for the deposit
    event AutoSaved(uint256 externalChainId, string externalTxHash, uint256 mintedAmount, uint256 mTokenAmount);

    /* ===================================================================== */
    /*                            STATE VARIABLES                            */
    /* ===================================================================== */
    // ───────────── Admin related state variables ─────────────
    /// @notice Standard decimal places for STRATO tokens
    /// @dev Default: 18 decimals for all STRATO tokens
    /// @dev Used for decimal conversion between external tokens and STRATO tokens
    uint256 public DECIMAL_PLACES = 18;

    /// @notice Circuit breaker for deposit operations
    /// @dev When true, all deposit operations are paused
    bool public depositsPaused;
    
    /// @notice Token factory contract for creating new STRATO tokens
    /// @dev Single source of truth for active token creation
    address public tokenFactory;

    /// @notice Lending registry contract for managing auto earning
    address public lendingRegistry;
    
    /// @notice USDST token address for cross-chain minting/redeeming
    /// @dev Default USDST address: 0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010
    address public USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
    
    /// @notice Circuit breaker for withdrawal operations
    /// @dev When true, all withdrawal operations are paused
    bool public withdrawalsPaused;
    
    /// @notice Time delay before users can abort stuck withdrawals
    /// @dev Default: 172800 seconds (48 hours)
    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;

    // ───────────── Deposit & withdrawal related state variables ─────────────
    /// @notice Registry of deposit transactions with replay protection
    /// @dev Maps external chain ID and transaction hash to deposit information
    /// @dev Key: (externalChainId, externalTxHash) -> Value: DepositInfo struct
    /// @dev Prevents duplicate processing of the same external transaction
    /// @dev Stores deposit state and conversion information
    mapping(uint256 => mapping(string => DepositInfo)) public record deposits;

    /// @notice Registry of requests to supply liquidity to the lending pool upon deposit completion
    /// @dev Maps user address, external chain ID, and transaction hash
    ///      to a boolean indicating whether that user wishes to autosave the indicated deposit
    /// @dev Only autoSave requests from the deposit recipient will be honored
    /// @dev Only autoSave requests for the strato token borrowable in the lending pool will be performed
    /// @dev Key: (userAddress, externalChainId, externalTxHash) -> Value: bool
    mapping(address => mapping (uint256 => mapping(string => bool))) public record autoSaveRequested;

    /// @notice Registry of withdrawal requests by withdrawal ID
    /// @dev Maps withdrawal ID to withdrawal information
    /// @dev Key: withdrawalId (uint256) -> Value: WithdrawalInfo struct
    mapping(uint256 => WithdrawalInfo) public record withdrawals;
    
    /// @notice Auto-incrementing counter for withdrawal IDs
    /// @dev Ensures unique withdrawal identifiers for each request
    uint256 public withdrawalCounter;

    // ───────────── Registry related state variables ─────────────
    /// @notice Registry of external chains and their configuration
    /// @dev Maps external chain ID to chain information including custody, router, and processing state
    /// @dev Key: externalChainId (uint256) -> Value: ChainInfo struct
    mapping(uint256 => ChainInfo) public record chains;
    
    /// @notice Registry of assets for each external chain
    /// @dev Maps external token address and chain ID to asset configuration
    /// @dev Key: (externalToken address, externalChainId) -> Value: AssetInfo struct
    /// @dev Used to configure token mappings between external chains and STRATO
    /// @dev Includes decimal conversion information for each token pair
    mapping(address => mapping(uint256 => AssetInfo)) public record assets;


    /* ===================================================================== */
    /*                            MODIFIERS                                  */
    /* ===================================================================== */
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

    /* ===================================================================== */
    /*                            FUNCTIONS                                  */
    /* ===================================================================== */
    // ───────────── Constructor related functions ─────────────
    /**
     * @dev Initializes the MercataBridge contract with the specified owner
     * @notice Sets up the bridge system with ownership and access control
     * @notice This is the main bridge contract that handles all cross-chain operations
     * @param _owner The address that will be set as the contract owner
     */
    constructor(
        address _owner
    ) Ownable(_owner) { }

    /**
     * @dev Initializes the bridge system with essential configuration
     * @notice Sets up token factory and default values for the bridge
     * @notice Must be called after deployment to configure the bridge properly
     * @notice Configures decimal places, USDST address, and withdrawal timeout
     * @param _tokenFactory The token factory contract address for creating STRATO tokens
     */
    function initialize(
        address _tokenFactory,
        address _lendingRegistry
    ) external onlyOwner {
        DECIMAL_PLACES = 18;
        USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
        WITHDRAWAL_ABORT_DELAY = 172800;

        setTokenFactory(_tokenFactory);
        setLendingRegistry(_lendingRegistry);
    }

    // ───────────── Admin related functions ─────────────
    /**
     * @dev Emergency function to set the last processed block for a chain
     * @notice Allows rollback of block processing state in emergency situations
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The block number to set as last processed
     */
    function emergencySetLastProcessedBlock(
        uint256 externalChainId, uint256 lastProcessedBlock
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid external chain id");
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "MB: chain missing");
        
        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
        emit EmergencyBlockRollback(externalChainId, lastProcessedBlock);
    }

    /**
     * @dev Sets asset configuration for a specific external chain
     * @notice Maps external tokens to their STRATO equivalents with withdrawal limits
     * @notice Configures decimal conversion between external tokens and STRATO tokens
     * @param enabled Whether the asset is enabled for bridge operations
     * @param externalChainId The external chain identifier
     * @param externalDecimals The number of decimals for the external token (used for conversion)
     * @param externalName The name of the external token
     * @param externalSymbol The symbol of the external token
     * @param externalToken The address of the external token contract
     * @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
     * @param stratoToken The corresponding STRATO token address
     */
    function setAsset(
        bool enabled, uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken
    ) external onlyOwner {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        require(externalName.length > 0, "MB: invalid external name");
        require(externalSymbol.length > 0, "MB: invalid external symbol");
        require(stratoToken != address(0), "MB: invalid strato token");
        require(externalDecimals <= DECIMAL_PLACES, "MB: decimals exceed max");
        assets[externalToken][externalChainId] = AssetInfo(enabled, externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken);
        emit AssetUpdated(enabled, externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken);
    }

    /**
     * @dev Updates asset metadata (name and symbol) for an existing asset
     * @notice Only the owner can update asset metadata for existing assets
     * @notice Allows updating token display information without recreating the asset
     * @notice Validates that the asset exists before updating metadata
     * @param externalChainId The external chain identifier where the asset is configured
     * @param externalName The new name of the external token
     * @param externalSymbol The new symbol of the external token
     * @param externalToken The external token address to update
     */
    function setAssetMetadata(
        uint256 externalChainId, string externalName, string externalSymbol, address externalToken
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid chain id");
        require(externalName.length > 0, "MB: invalid external name");
        require(externalSymbol.length > 0, "MB: invalid external symbol");
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        AssetInfo assetInfo = assets[externalToken][externalChainId];
        require(assetInfo.externalToken == externalToken, "MB: asset not found");
        assetInfo.externalName = externalName;
        assetInfo.externalSymbol = externalSymbol;
        emit AssetUpdated(assetInfo.enabled, externalChainId, assetInfo.externalDecimals, externalName, externalSymbol, externalToken, assetInfo.maxPerWithdrawal, assetInfo.stratoToken);
    }

    /**
     * @dev Sets token withdrawal limits for an existing asset
     * @notice Only the owner can set withdrawal limits for existing assets
     * @notice Allows configuring maximum withdrawal amounts for risk management
     * @notice Setting maxPerWithdrawal to 0 means unlimited withdrawals
     * @notice Validates that the asset exists before updating limits
     * @param externalChainId The external chain identifier where the asset is configured
     * @param externalToken The external token address to update limits for
     * @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
     */
    function setWithdrawalLimits(
        uint256 externalChainId, address externalToken, uint256 maxPerWithdrawal
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid chain id");
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        AssetInfo assetInfo = assets[externalToken][externalChainId];
        require(assetInfo.externalToken == externalToken, "MB: asset not found");
        assetInfo.maxPerWithdrawal = maxPerWithdrawal;
        emit AssetUpdated(assetInfo.enabled, externalChainId, assetInfo.externalDecimals, assetInfo.externalName, assetInfo.externalSymbol, externalToken, maxPerWithdrawal, assetInfo.stratoToken);
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
        string chainName, address custody, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router
    ) external onlyOwner {
        require(chainName.length > 0, "MB: invalid chain name");
        require(custody != address(0), "MB: zero custody address");
        require(externalChainId > 0, "MB: invalid external chain id");
        require(router != address(0), "MB: zero router address");
        chains[externalChainId] = ChainInfo(chainName, custody, router, enabled, lastProcessedBlock);
        emit ChainUpdated(chainName, custody, enabled, externalChainId, lastProcessedBlock, router);
    }

    /**
     * @dev Updates the last processed block for a specific chain
     * @notice Prevents rollback attacks by ensuring block numbers only increase
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The new last processed block number
     */
    function setLastProcessedBlock(
        uint256 externalChainId, uint256 lastProcessedBlock
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid external chain id");
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "MB: chain missing");
        
        require(lastProcessedBlock >= chainInfo.lastProcessedBlock, "MB: cannot rollback block");
        
        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
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
     * @dev Sets the token factory address
     * @notice Only the owner can update the token factory address
     * @param newFactory The new token factory address (must not be zero address)
     */
    function setTokenFactory(address newFactory) public onlyOwner {
        require(newFactory != address(0), "MB: zero");
        emit TokenFactoryUpdated(newFactory, tokenFactory);
        tokenFactory = newFactory;
    }

    /**
     * @dev Sets the lending registry address
     * @notice Only the owner can update the lending registry address
     * @param newLendingRegistry The new lending registry address (must not be zero address)
     */
    function setLendingRegistry(address newLendingRegistry) public onlyOwner {
        require(newLendingRegistry != address(0), "MB: zero lending registry address");
        emit LendingRegistryUpdated(newLendingRegistry, lendingRegistry);
        lendingRegistry = newLendingRegistry;
    }

    /**
     * @dev Sets the USDST token address
     * @notice Only the owner can update the USDST address
     * @param newUSDSTAddress The new USDST token address (must not be zero address)
     */
    function setUSDSTAddress(address newUSDSTAddress) external onlyOwner {
        require(newUSDSTAddress != address(0), "MB: zero USDST address");
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
        require(externalChainId > 0, "MB: invalid chain id");
        require(chains[externalChainId].custody != address(0), "MB: chain not found");
        
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
        require(externalChainId > 0, "MB: invalid chain id");
        require(assets[externalToken][externalChainId].externalChainId == externalChainId, "MB: asset not found");
        
        assets[externalToken][externalChainId].enabled = enabled;
        emit AssetToggled(enabled, externalChainId, externalToken);
    }

    // ───────────── Escrow related functions ─────────────
    /**
     * @dev Burns tokens from the escrow contract
     * @param token The token contract address
     * @param amount The amount of tokens to burn
     * @return actualAmount The actual amount of tokens burned
     */
    function _burnFunds(address token, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        Token(token).burn(address(this), amount);
        actualAmount = balanceBefore - IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "MB: no tokens burned");
    }

    /**
     * @dev Escrows tokens from a user to this contract
     * @param token The token contract address
     * @param from The address to transfer tokens from
     * @param amount The amount of tokens to escrow
     * @return actualAmount The actual amount of tokens escrowed
     */
    function _escrowFunds(address token, address from, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(from, address(this), amount), "MB: transfer failed");
        actualAmount = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(actualAmount > 0, "MB: no tokens received");
    }

    /**
     * @dev Mints tokens to a recipient address
     * @param token The token contract address
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     * @return actualAmount The actual amount of tokens minted
     */
    function _mintFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        Token(token).mint(to, amount);
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "MB: no tokens minted");
    }

    /**
     * @dev Refunds tokens from this contract to a recipient
     * @param token The token contract address
     * @param to The address to refund tokens to
     * @param amount The amount of tokens to refund
     * @return actualAmount The actual amount of tokens refunded
     */
    function _refundFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transfer(to, amount), "MB: transfer failed");
        actualAmount = balanceBefore - IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "MB: no tokens sent");
    }

    function _autoSave(DepositInfo d, uint256 externalChainId, string normalizedTxHash) internal {
        // Autosaving is disabled if lendingRegistry is null
        require(address(lendingRegistry) != address(0), "MB: lending registry not set");

        LendingPool lendingPool = LendingRegistry(lendingRegistry).lendingPool();
        LiquidityPool liquidityPool = LendingRegistry(lendingRegistry).liquidityPool();
        Token mToken = Token(lendingPool.mToken());

        // Can only autosave the underlying asset of the lending pool
        require(d.stratoToken == lendingPool.borrowableAsset(), "MB: cannot autosave token");

        // Mint funds to this contract temporarily to deposit into the lending pool
        uint256 actualMintedAmount = _mintFunds(d.stratoToken, this, d.stratoTokenAmount);
        require(actualMintedAmount > 0, "MB: no tokens minted");

        // Deposit into the lending pool on behalf of the recipient
        Token(d.stratoToken).approve(address(liquidityPool), actualMintedAmount);
        uint balanceBefore = Token(mToken).balanceOf(d.stratoRecipient);
        lendingPool.depositLiquidityOnBehalfOf(d.stratoRecipient, actualMintedAmount);
        uint mTokenAmount = Token(mToken).balanceOf(d.stratoRecipient) - balanceBefore;
        require(mTokenAmount > 0, "MB: autosave failed");

        emit AutoSaved(externalChainId, normalizedTxHash, actualMintedAmount, mTokenAmount);
    }

    // ───────────── Deposit & withdrawal related functions ─────────────
    // ───────────── Deposit flow functions ─────────────
    /**
     * @dev Records a deposit transaction from an external chain
     * @notice Step-1 of the deposit flow - observes external transaction
     * @notice Creates deposit record but does NOT mint tokens yet
     * @notice Allows off-chain confirmation windows and fraud checks before step-2
     * @notice Converts external token amounts to STRATO token amounts using decimal conversion
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalSender The address that sent the transaction on the external chain
     * @param externalToken The token address on the external chain
     * @param externalTokenAmount The amount of external tokens to deposit (in external token decimals)
     * @param externalTxHash The transaction hash on the external chain
     * @param stratoRecipient The STRATO address to receive the minted tokens
     */
    function deposit(
        uint256 externalChainId, address externalSender, address externalToken, uint256 externalTokenAmount, string externalTxHash, address stratoRecipient
    ) public onlyOwner whenDepositsOpen {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(externalSender != address(0), "MB: invalid external sender");
        require(externalTokenAmount > 0, "MB: invalid external token amount");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");
        require(stratoRecipient != address(0), "MB: invalid strato recipient");
        require(chains[externalChainId].enabled, "MB: chain not enabled");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = externalTxHash.normalizeHex();
        require(deposits[externalChainId][normalizedTxHash].bridgeStatus == BridgeStatus.NONE, "MB: duplicate deposit");

        AssetInfo a = assets[externalToken][externalChainId];
        require(a.enabled, "MB: asset not enabled");
        require(TokenFactory(tokenFactory).isTokenActive(a.stratoToken), "MB: inactive token");

        // Example: 1e6 USDC * 10^(18-6) = 1e6 * 10^12 = 1e18 USDCST tokens
        uint256 stratoTokenAmount = externalTokenAmount * (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(stratoTokenAmount > 0, "MB: invalid strato token amount");

        deposits[externalChainId][normalizedTxHash] = DepositInfo(
            BridgeStatus.INITIATED, externalSender, externalToken, block.timestamp, stratoRecipient, a.stratoToken, stratoTokenAmount, block.timestamp
        );

        emit DepositInitiated(externalChainId, externalSender, normalizedTxHash, stratoRecipient, a.stratoToken, stratoTokenAmount);
    }
    
    /**
     * @dev Records multiple deposit transactions from external chains in a single call
     * @notice Batch version of deposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual deposit function
     * @notice Converts external token amounts to STRATO token amounts using decimal conversion
     * @param externalChainIds Array of external chain identifiers
     * @param externalSenders Array of external sender addresses
     * @param externalTokens Array of external token addresses
     * @param externalTokenAmounts Array of external token amounts (in external token decimals)
     * @param externalTxHashes Array of external transaction hashes
     * @param stratoRecipients Array of STRATO recipient addresses
     */
    function depositBatch(
        uint256[] externalChainIds, address[] externalSenders, address[] externalTokens, uint256[] externalTokenAmounts, string[] externalTxHashes, address[] stratoRecipients
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalSenders.length && n == externalTokens.length && n == externalTokenAmounts.length && n == externalTxHashes.length && n == stratoRecipients.length, "MB: len");
        for (uint256 i = 0; i < n; i++) {
            deposit(externalChainIds[i], externalSenders[i], externalTokens[i], externalTokenAmounts[i], externalTxHashes[i], stratoRecipients[i]);
        }
    }

    function requestAutoSave(uint externalChainId, string externalTxHash) external {
        string normalizedTxHash = externalTxHash.normalizeHex();

        require(deposits[externalChainId][normalizedTxHash].bridgeStatus != BridgeStatus.COMPLETED, "MB: Already completed");
        autoSaveRequested[msg.sender][externalChainId][normalizedTxHash] = true;

        emit AutoSaveRequested(msg.sender, externalChainId, normalizedTxHash);
    }

    /**
     * @dev Confirms a deposit and mints wrapped tokens
     * @notice Step-2.1 of the deposit flow - verification passed, mint wrapped tokens
     * @notice Only deposits in INITIATED or PENDING_REVIEW status can be confirmed
     * @notice Mints the corresponding STRATO tokens to the recipient
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     */
    function confirmDeposit(
        uint256 externalChainId, string externalTxHash
    ) public onlyOwner whenDepositsOpen {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(chains[externalChainId].enabled, "MB: chain not enabled");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED || d.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        bool didAutoSave = false;
        if (autoSaveRequested[d.stratoRecipient][externalChainId][normalizedTxHash]) {
            try {
                _autoSave(d, externalChainId, normalizedTxHash);
                didAutoSave = true;
                delete autoSaveRequested[d.stratoRecipient][externalChainId][normalizedTxHash];
            } catch {} // On failure, mint stratoToken to the recipient instead
        }
        if (!didAutoSave) {
            uint256 actualMintedAmount = _mintFunds(d.stratoToken, d.stratoRecipient, d.stratoTokenAmount);
            require(actualMintedAmount > 0, "MB: no tokens minted");
        }

        d.bridgeStatus = BridgeStatus.COMPLETED;
        d.timestamp = block.timestamp;
        emit DepositCompleted(externalChainId, normalizedTxHash);
    }

    /**
     * @dev Confirms multiple deposits and mints wrapped tokens in a single call
     * @notice Batch version of confirmDeposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual confirmDeposit function
     * @param externalChainIds Array of external chain identifiers
     * @param externalTxHashes Array of external transaction hashes
     */
    function confirmDepositBatch(
        uint256[] externalChainIds, string[] externalTxHashes
    ) external onlyOwner whenDepositsOpen {   
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "MB: len");
        for (uint256 i = 0; i < n; i++) {
            confirmDeposit(externalChainIds[i], externalTxHashes[i]);
        }
    }

    /**
     * @dev Sets a deposit for manual review when verification fails
     * @notice Step-2.2 of the deposit flow - verification failed, set deposit for manual review
     * @notice Only deposits in INITIATED status can be set for review
     * @notice Owner can later abort or manually confirm reviewed deposits
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     */
    function reviewDeposit(
        uint256 externalChainId, string externalTxHash
    ) public onlyOwner whenDepositsOpen {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(chains[externalChainId].enabled, "MB: chain not enabled");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        d.timestamp = block.timestamp;

        emit DepositPendingReview(externalChainId, normalizedTxHash);
    }

    /**
     * @dev Sets multiple deposits for manual review when verification fails
     * @notice Batch version of reviewDeposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual reviewDeposit function
     * @param externalChainIds Array of external chain identifiers
     * @param externalTxHashes Array of external transaction hashes
     */
    function reviewDepositBatch(
        uint256[] externalChainIds, string[] externalTxHashes
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            reviewDeposit(externalChainIds[i], externalTxHashes[i]);
        }
    }

    /**
     * @dev Aborts a deposit that was marked for manual review
     * @notice Step-2.3 of the deposit flow - cancel a deposit that was marked for review
     * @notice Only deposits in PENDING_REVIEW status can be aborted
     * @notice Only the owner can abort deposits, preventing token minting
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     */
    function abortDeposit(
        uint256 externalChainId, string externalTxHash
    ) public onlyOwner {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(chains[externalChainId].enabled, "MB: chain not enabled");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        d.bridgeStatus = BridgeStatus.ABORTED;
        d.timestamp = block.timestamp;

        emit DepositAborted(externalChainId, normalizedTxHash);
    }

    /**
     * @dev Aborts multiple deposits that were marked for manual review
     * @notice Batch version of abortDeposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual abortDeposit function
     * @param externalChainIds Array of external chain identifiers
     * @param externalTxHashes Array of external transaction hashes
     */
    function abortDepositBatch(
        uint256[] externalChainIds, string[] externalTxHashes
    ) external onlyOwner {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            abortDeposit(externalChainIds[i], externalTxHashes[i]);
        }
    }

    // ───────────── Withdrawal flow functions ─────────────
    /**
     * @dev Initiates a withdrawal request by escrowing tokens and creating a withdrawal record
     * @notice Step-1 of the withdrawal flow - user moves tokens into bridge escrow and creates request
     * @notice Returns deterministic withdrawal ID for indexers to enumerate without extra mappings
     * @notice Tokens are escrowed until the withdrawal is confirmed or aborted
     * @notice Converts STRATO token amounts to external token amounts using decimal conversion
     * @notice Any dust from decimal conversion rounding is kept by the user
     * @param externalChainId The external chain identifier where tokens should be sent
     * @param externalRecipient The address on the external chain to receive the tokens
     * @param externalToken The token address on the external chain
     * @param stratoTokenAmount The amount of STRATO tokens to withdraw (any dust from decimal conversion will be kept by user)
     * @return id The unique withdrawal identifier
     */
    function requestWithdrawal(
        uint256 externalChainId, address externalRecipient, address externalToken, uint256 stratoTokenAmount
    ) external whenWithdrawalsOpen returns (uint256 id) {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(externalRecipient != address(0), "MB: invalid external recipient");
        require(stratoTokenAmount > 0, "MB: invalid strato token amount");
        require(chains[externalChainId].enabled, "MB: chain not enabled");

        AssetInfo a = assets[externalToken][externalChainId];
        require(a.enabled, "MB: asset not enabled");
        require(TokenFactory(tokenFactory).isTokenActive(a.stratoToken), "MB: inactive token");

        // Example: 1e18 USDCST tokens / 10^(18-6) = 1e18 / 10^12 = 1e6 USDC
        // Round down to the nearest integer
        uint256 externalTokenAmount = stratoTokenAmount / (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(externalTokenAmount > 0, "MB: not enough external tokens");

        stratoTokenAmount = externalTokenAmount * (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(a.maxPerWithdrawal == 0 || stratoTokenAmount <= a.maxPerWithdrawal, "MB: per-withdrawal cap");
        stratoTokenAmount = _escrowFunds(a.stratoToken, msg.sender, stratoTokenAmount);
        require(stratoTokenAmount > 0, "MB: no tokens escrowed");

        // Example: 1e18 USDCST tokens / 10^(18-6) = 1e18 / 10^12 = 1e6 USDC
        // Round down to the nearest integer
        externalTokenAmount = stratoTokenAmount / (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(externalTokenAmount > 0, "MB: invalid external token amount");

        id = ++withdrawalCounter;

        withdrawals[id] = WithdrawalInfo(
            BridgeStatus.INITIATED, "", externalChainId, externalRecipient, externalToken, externalTokenAmount, block.timestamp, msg.sender, a.stratoToken, stratoTokenAmount, block.timestamp
        );

        emit WithdrawalRequested(externalRecipient, externalChainId, externalTokenAmount, stratoTokenAmount, a.stratoToken, msg.sender, id);
    }

    /**
     * @dev Confirms a withdrawal request and sets it to pending review
     * @notice Step-2 of the withdrawal flow - custody transaction has been created but not executed
     * @notice Stores the custody transaction hash so UI can show approval progress
     * @notice Only withdrawals in INITIATED status can be confirmed
     * @param id The unique withdrawal identifier
     * @param custodyTxHash The custody transaction hash on the external chain
     */
    function confirmWithdrawal(
        uint256 id, string custodyTxHash
    ) public onlyOwner whenWithdrawalsOpen {
        require(id > 0, "MB: invalid withdrawal id");
        require(custodyTxHash.length > 0, "MB: invalid custody tx hash");

        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.timestamp = block.timestamp;

        // Normalize the custody tx hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedCustodyTxHash = custodyTxHash.normalizeHex();
        w.custodyTxHash = normalizedCustodyTxHash;

        emit WithdrawalPending(normalizedCustodyTxHash, id);
    }

    /**
     * @dev Confirms multiple withdrawal requests and sets them to pending review
     * @notice Batch version of confirmWithdrawal function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each withdrawal follows the same validation rules as individual confirmWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     * @param custodyTxHashes Array of custody transaction hashes on the external chain
     */
    function confirmWithdrawalBatch(
        uint256[] ids, string[] custodyTxHashes
    ) external onlyOwner whenWithdrawalsOpen {
        uint256 n = ids.length;
        require(n > 0 && n == custodyTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            confirmWithdrawal(ids[i], custodyTxHashes[i]);
        }
    }

    /**
     * @dev Finalizes a withdrawal by burning the escrowed tokens
     * @notice Step-3 of the withdrawal flow - custody transaction executed successfully, burn escrow
     * @notice Only withdrawals in PENDING_REVIEW status can be finalized
     * @notice Burns the corresponding STRATO tokens to complete the withdrawal
     * @param id The unique withdrawal identifier
     */
    function finaliseWithdrawal(
        uint256 id
    ) public onlyOwner whenWithdrawalsOpen {
        require(id > 0, "MB: invalid withdrawal id");

        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        uint256 actualBurnedAmount = _burnFunds(w.stratoToken, w.stratoTokenAmount);
        require(actualBurnedAmount > 0, "MB: no tokens burned");

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;

        emit WithdrawalCompleted(id);
    }

    /**
     * @dev Finalizes multiple withdrawals by burning the escrowed tokens
     * @notice Batch version of finaliseWithdrawal function for gas efficiency
     * @notice Each withdrawal follows the same validation rules as individual finaliseWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     */
    function finaliseWithdrawalBatch(
        uint256[] ids
    ) external onlyOwner whenWithdrawalsOpen {
        uint256 n = ids.length;
        require(n > 0, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            finaliseWithdrawal(ids[i]);
        }
    }

    /**
     * @dev Aborts a withdrawal and refunds the escrowed tokens
     * @notice Step-4 of the withdrawal flow - abort a withdrawal and refund tokens
     * @notice Admin can abort any withdrawal in INITIATED or PENDING_REVIEW status
     * @notice User can only abort their own withdrawal in INITIATED status after timeout
     * @notice Covers the scenario where admin disappears before confirming
     * @notice Does not cover the scenario where custody transaction is waiting to be signed
     * @param id The unique withdrawal identifier
     */
    function abortWithdrawal(
        uint256 id
    ) public {
        require(id > 0, "MB: invalid withdrawal id");

        WithdrawalInfo w = withdrawals[id];
        uint256 currentTimestamp = block.timestamp;

        AdminRegistry admin = AdminRegistry(owner());
        if (admin.whitelist(address(this), "abortWithdrawal", msg.sender)) {
            require(w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: not abortable");
        }
        else {
            require(msg.sender == w.stratoSender, "MB: not sender");
            require(w.bridgeStatus == BridgeStatus.INITIATED, "MB: not abortable");
            require(currentTimestamp >= w.requestedAt + WITHDRAWAL_ABORT_DELAY, "MB: wait 48h");
        }

        w.bridgeStatus = BridgeStatus.ABORTED;
        w.timestamp = currentTimestamp;

        uint256 actualRefundedAmount = _refundFunds(w.stratoToken, w.stratoSender, w.stratoTokenAmount);
        require(actualRefundedAmount > 0, "MB: no tokens refunded");

        emit WithdrawalAborted(id);
    }

    /**
     * @dev Aborts multiple withdrawals and refunds the escrowed tokens
     * @notice Batch version of abortWithdrawal function for gas efficiency
     * @notice Each withdrawal follows the same validation rules as individual abortWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     */
    function abortWithdrawalBatch(
        uint256[] ids
    ) external {
        uint256 n = ids.length;
        require(n > 0, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            abortWithdrawal(ids[i]);
        }
    }
}