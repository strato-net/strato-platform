import "VaultFactory.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/utils/Pausable.sol";
import "../Lending/PriceOracle.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";

/**
 * @title Vault
 * @notice Multi-asset vault that pools user deposits and deploys inventory into a bot executor.
 */
contract record Vault is Ownable, Pausable {

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    event Deposited(address indexed user, address indexed asset, uint amountIn, uint sharesMinted, uint depositValueUSD);
    event Withdrawn(address indexed user, uint sharesBurned, uint withdrawValueUSD);
    event WithdrawalPayout(address indexed user, address indexed asset, uint amount);
    event AssetAdded(address indexed asset);
    event AssetRemoved(address indexed asset);
    event MinReserveUpdated(address indexed asset, uint newMinReserve);
    event BotExecutorUpdated(address indexed newBotExecutor);
    event PriceOracleUpdated(address indexed newPriceOracle);

    // Minimum USD value for the first deposit to prevent share manipulation attacks (1e18 = $1)
    uint public MIN_FIRST_DEPOSIT_USD;

    // WAD precision (1e18)
    uint public WAD;

    // Reentrancy guard
    bool private locked;

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @notice The vault factory that created this vault
    VaultFactory public vaultFactory;

    // Share token
    address public shareToken;

    // Supported assets
    address[] public record supportedAssets;
    mapping(address => bool) public record isSupported;

    // Per-asset minimum reserves (token base units, 18 decimals)
    mapping(address => uint) public record minReserve;

    // Bot executor authorized to call swap execution
    address public botExecutor;

    // Price oracle providing USD prices for all supported assets
    PriceOracle public priceOracle;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Initialize the vault with required configuration
     * @param _priceOracle Address of the price oracle contract
     * @param _botExecutor Address authorized to execute swaps
     * @param _shareToken Address of the share token (created by factory)
     * @dev Must be called once after deployment or proxy creation
     * @dev Share token is created by VaultFactory and passed here
     */
    function initialize(
        address _priceOracle,
        address _botExecutor,
        address _shareToken
    ) external onlyOwner {
        WAD = 1e18;
        MIN_FIRST_DEPOSIT_USD = 50000 * WAD; // $50,000

        require(_priceOracle != address(0), "Vault: invalid oracle");
        require(_botExecutor != address(0), "Vault: invalid bot executor");
        require(_shareToken != address(0), "Vault: invalid share token");


        priceOracle = PriceOracle(_priceOracle);
        botExecutor = _botExecutor;
        shareToken = _shareToken;
        vaultFactory = VaultFactory(msg.sender);

        emit PriceOracleUpdated(_priceOracle);
        emit BotExecutorUpdated(_botExecutor);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════


    modifier onlySupportedAsset(address asset) {
        require(isSupported[asset], "Vault: asset not supported");
        _;
    }

    /// @notice Prevents reentrant calls to functions
    modifier nonReentrant() {
        require(!locked, "Vault: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // DEPOSIT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit a supported token and receive vault shares
     * @param assetIn Address of the token to deposit
     * @param amountIn Amount of tokens to deposit
     * @return sharesMinted Number of shares minted to the depositor
     * @dev 
     *   - If any token is below minimum reserve, only deficit tokens may be deposited
     *   - First deposit requires minimum $50,000 USD value
     *   - Shares minted proportional to deposit value relative to total equity
     */
    function deposit(address assetIn, uint amountIn) external nonReentrant whenNotPaused onlySupportedAsset(assetIn) returns (uint sharesMinted) {
        require(shareToken != address(0), "Vault: not initialized");
        require(amountIn > 0, "Vault: zero amount");

        // Check deposit eligibility (deficit-preferential rule)
        _checkDepositEligibility(assetIn);

        uint price = priceOracle.getAssetPrice(assetIn);
        require(price > 0, "Vault: invalid price");

        uint depositValueUSD = (amountIn * price) / WAD;

        uint currentSupply = IERC20(shareToken).totalSupply();

        // First deposit check
        if (currentSupply == 0) {
            require(depositValueUSD >= MIN_FIRST_DEPOSIT_USD, "Vault: first deposit too small");
            // First deposit: 1 share ≈ $1 USD
            sharesMinted = depositValueUSD;
        } else {
            // Subsequent deposits: mint proportional to existing equity
            uint preDepositEquity = getTotalEquity();
            require(preDepositEquity > 0, "Vault: zero equity");
            sharesMinted = (depositValueUSD * currentSupply) / preDepositEquity;
        }

        require(sharesMinted > 0, "Vault: zero shares");

        // Transfer tokens from depositor to vault
        bool success = IERC20(assetIn).transferFrom(msg.sender, address(botExecutor), amountIn);
        require(success, "Vault: transfer failed");

        // Mint shares to depositor
        Token(shareToken).mint(msg.sender, sharesMinted);

        emit Deposited(msg.sender, assetIn, amountIn, sharesMinted, depositValueUSD);

        return sharesMinted;
    }

    /**
     * @notice Check if a deposit is eligible based on deficit-preferential rules
     * @param assetIn The asset being deposited
     * @dev If any token is below minimum reserve, only deficit tokens may be deposited
     */
    function _checkDepositEligibility(address assetIn) internal view {
        bool hasDeficit = false;
        bool assetIsDeficit = false;

        for (uint i = 0; i < supportedAssets.length; i++) {
            address asset = supportedAssets[i];
            uint balance = IERC20(asset).balanceOf(address(botExecutor));
            uint minRes = minReserve[asset];

            if (balance < minRes) {
                hasDeficit = true;
                if (asset == assetIn) {
                    assetIsDeficit = true;
                }
            }
        }

        // If deficit exists, deposited asset must be a deficit asset
        if (hasDeficit) {
            require(assetIsDeficit, "Vault: must deposit deficit asset");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // WITHDRAWAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Withdraw by specifying USD value to redeem
     * @param amountUSD USD value to withdraw (1e18 = $1)
     * @return sharesBurned Number of shares burned
     * @dev 
     *   - Payouts drawn from withdrawable assets (above minimum reserves)
     *   - Tokens at minimum reserve are skipped
     *   - Payout allocated proportionally to withdrawable USD weight
     */
    function withdraw(uint amountUSD) external nonReentrant whenNotPaused returns (uint sharesBurned) {
        require(shareToken != address(0), "Vault: not initialized");
        require(amountUSD > 0, "Vault: zero amount");

        uint totalEquityVal = getTotalEquity();
        require(totalEquityVal > 0, "Vault: zero equity");

        uint currentSupply = IERC20(shareToken).totalSupply();
        require(currentSupply > 0, "Vault: no shares");

        // Calculate shares to burn
        sharesBurned = (amountUSD * currentSupply) / totalEquityVal;
        require(sharesBurned > 0, "Vault: zero shares to burn");
        require(IERC20(shareToken).balanceOf(msg.sender) >= sharesBurned, "Vault: insufficient shares");

        // Compute withdrawable equity and verify feasibility
        uint withdrawableEquity = getWithdrawableEquity();
        require(amountUSD <= withdrawableEquity, "Vault: insufficient withdrawable liquidity");

        // Burn shares first 
        Token(shareToken).burn(msg.sender, sharesBurned);

        // Calculate and transfer payouts
        _executeWithdrawalPayouts(amountUSD, withdrawableEquity);

        emit Withdrawn(msg.sender, sharesBurned, amountUSD);

        return sharesBurned;
    }

    /**
     * @notice Withdraw by specifying number of shares to redeem
     * @param sharesToBurn Number of shares to burn
     * @return amountUSD USD value withdrawn
     */
    function withdrawShares(uint sharesToBurn) external nonReentrant whenNotPaused returns (uint amountUSD) {
        require(shareToken != address(0), "Vault: not initialized");
        require(sharesToBurn > 0, "Vault: zero shares");
        require(IERC20(shareToken).balanceOf(msg.sender) >= sharesToBurn, "Vault: insufficient shares");

        uint totalEquityVal = getTotalEquity();
        require(totalEquityVal > 0, "Vault: zero equity");

        uint currentSupply = IERC20(shareToken).totalSupply();

        // Calculate USD value of shares
        amountUSD = (sharesToBurn * totalEquityVal) / currentSupply;
        require(amountUSD > 0, "Vault: zero value");

        // Compute withdrawable equity and verify feasibility
        uint withdrawableEquity = getWithdrawableEquity();
        require(amountUSD <= withdrawableEquity, "Vault: insufficient withdrawable liquidity");

        // Burn shares first
        Token(shareToken).burn(msg.sender, sharesToBurn);

        // Calculate and transfer payouts
        _executeWithdrawalPayouts(amountUSD, withdrawableEquity);

        emit Withdrawn(msg.sender, sharesToBurn, amountUSD);

        return amountUSD;
    }

    /**
     * @notice Execute withdrawal payouts proportionally across withdrawable assets
     * @param amountUSD Total USD value to pay out
     * @param withdrawableEquity Total withdrawable equity (pre-computed)
     */
    function _executeWithdrawalPayouts(uint amountUSD, uint withdrawableEquity) internal {
        require(withdrawableEquity > 0, "Vault: no withdrawable equity");

        for (uint i = 0; i < supportedAssets.length; i++) {
            address asset = supportedAssets[i];
            uint balance = IERC20(asset).balanceOf(address(botExecutor));
            uint minRes = minReserve[asset];

            // Calculate withdrawable amount for this asset
            uint withdrawable = 0;
            if (balance > minRes) {
                withdrawable = balance - minRes;
            }

            if (withdrawable == 0) {
                continue; // Skip assets at or below minimum reserve
            }

            // Get asset price
            uint price = priceOracle.getAssetPrice(asset);
            if (price == 0) {
                continue;
            }

            // Calculate withdrawable USD value for this asset
            uint withdrawableUSD = (withdrawable * price) / WAD;

            // Calculate weight and payout
            // weight = withdrawableUSD / withdrawableEquity
            // payoutUSD = amountUSD * weight = amountUSD * withdrawableUSD / withdrawableEquity
            uint payoutUSD = (amountUSD * withdrawableUSD) / withdrawableEquity;

            // Convert USD payout to token amount (floor division - rounds in vault's favor)
            uint payout = (payoutUSD * WAD) / price;

            // Safety check: ensure we don't exceed withdrawable
            if (payout > withdrawable) {
                payout = withdrawable;
            }

            if (payout > 0) {
                bool success = IERC20(asset).transferFrom(address(botExecutor), msg.sender, payout);
                require(success, "Vault: transfer failed");
                emit WithdrawalPayout(msg.sender, asset, payout);
            }
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get total equity (NAV) of the vault in USD
     * @return equity Total value of all vault holdings in USD (1e18 = $1)
     */
    function getTotalEquity() public view returns (uint equity) {
        for (uint i = 0; i < supportedAssets.length; i++) {
            address asset = supportedAssets[i];
            uint balance = IERC20(asset).balanceOf(address(botExecutor));

            if (balance > 0) {
                uint price = priceOracle.getAssetPrice(asset);
                if (price > 0) {
                    equity += (balance * price) / WAD;
                }
            }
        }
        return equity;
    }

    /**
     * @notice Get withdrawable equity (assets above minimum reserves) in USD
     * @return withdrawableEquity Total withdrawable value in USD (1e18 = $1)
     */
    function getWithdrawableEquity() public view returns (uint withdrawableEquity) {
        for (uint i = 0; i < supportedAssets.length; i++) {
            address asset = supportedAssets[i];
            uint balance = IERC20(asset).balanceOf(address(botExecutor));
            uint minRes = minReserve[asset];

            if (balance > minRes) {
                uint withdrawable = balance - minRes;
                uint price = priceOracle.getAssetPrice(asset);
                if (price > 0) {
                    withdrawableEquity += (withdrawable * price) / WAD;
                }
            }
        }
        return withdrawableEquity;
    }

    /**
     * @notice Get NAV per share in USD
     * @return navPerShare USD value per share (1e18 = $1 per share)
     */
    function getNAVPerShare() public view returns (uint navPerShare) {
        if (shareToken == address(0)) {
            return WAD;
        }
        uint supply = IERC20(shareToken).totalSupply();
        if (supply == 0) {
            return WAD; // Default to $1 per share when no shares exist
        }
        uint equity = getTotalEquity();
        return (equity * WAD) / supply;
    }



    /**
     * @notice Get the withdrawable balance for a specific asset
     * @param asset Address of the asset
     * @return withdrawable Amount available for withdrawal (above min reserve)
     */
    function getWithdrawableBalance(address asset) public view returns (uint withdrawable) {
        require(isSupported[asset], "Vault: asset not supported");
        uint balance = IERC20(asset).balanceOf(address(botExecutor));
        uint minRes = minReserve[asset];

        if (balance > minRes) {
            return balance - minRes;
        }
        return 0;
    }

    /**
     * @notice Get all supported assets
     * @return assets Array of supported asset addresses
     */
    function getSupportedAssets() external view returns (address[] memory assets) {
        return supportedAssets;
    }


    /**
     * @notice Get comprehensive asset info for a single asset
     * @param asset Address of the asset
     * @return balance Current vault balance
     * @return minRes Configured minimum reserve
     * @return withdrawable Available for withdrawal
     * @return price Current oracle price (1e18 = $1)
     */
    function getAssetInfo(address asset) external view returns (
        uint balance,
        uint minRes,
        uint withdrawable,
        uint price
    ) {
        require(isSupported[asset], "Vault: asset not supported");
        balance = IERC20(asset).balanceOf(address(botExecutor));
        minRes = minReserve[asset];
        withdrawable = balance > minRes ? balance - minRes : 0;
        price = priceOracle.getAssetPrice(asset);
    }

    

    /**
     * @notice Check which assets are currently in deficit (below minimum reserve)
     * @return deficitAssets Array of asset addresses in deficit
     */
    function getDeficitAssets() external view returns (address[] memory deficitAssets) {
        // Count deficit assets
        uint count = 0;
        for (uint i = 0; i < supportedAssets.length; i++) {
            address asset = supportedAssets[i];
            uint balance = IERC20(asset).balanceOf(address(botExecutor));
            if (balance < minReserve[asset]) {
                count++;
            }
        }

        deficitAssets = new address[](count);
        uint idx = 0;
        for (uint j = 0; j < supportedAssets.length; j++) {
            address asset = supportedAssets[j];
            uint balance = IERC20(asset).balanceOf(address(botExecutor));
            if (balance < minReserve[asset]) {
                deficitAssets[idx] = asset;
                idx++;
            }
        }

        return deficitAssets;
    }

    /**
     * @notice Get user's share value in USD
     * @param user Address of the user
     * @return valueUSD USD value of user's shares (1e18 = $1)
     */
    function getUserValue(address user) external view returns (uint valueUSD) {
        if (shareToken == address(0)) {
            return 0;
        }
        uint userShares = IERC20(shareToken).balanceOf(user);
        if (userShares == 0) {
            return 0;
        }
        return (userShares * getNAVPerShare()) / WAD;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Add a supported asset to the vault
     * @param asset Address of the ERC-20 token to support
     */
    function addSupportedAsset(address asset) external onlyOwner {
        require(asset != address(0), "Vault: invalid asset");
        require(!isSupported[asset], "Vault: asset already supported");

        isSupported[asset] = true;
        supportedAssets.push(asset);

        emit AssetAdded(asset);
    }

    /**
     * @notice Remove a supported asset from the vault
     * @param asset Address of the token to remove
     * @dev Only allowed if vault has no balance of this asset
     */
    function removeSupportedAsset(address asset) external onlyOwner {
        require(isSupported[asset], "Vault: asset not supported");
        require(IERC20(asset).balanceOf(address(botExecutor)) == 0, "Vault: asset has balance");

        isSupported[asset] = false;

        // Remove from array by swapping with last element and reducing length
        for (uint i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == asset) {
                address lastAsset = supportedAssets[supportedAssets.length - 1];
                supportedAssets[i] = lastAsset;
                supportedAssets[supportedAssets.length - 1] = address(0);
                supportedAssets.length -= 1;
                break;
            }
        }

        // Clear min reserve
        minReserve[asset] = 0;

        emit AssetRemoved(asset);
    }

    /**
     * @notice Set minimum reserve for an asset
     * @param asset Address of the asset
     * @param newMinReserve New minimum reserve amount (token base units, 18 decimals)
     */
    function setMinReserve(address asset, uint newMinReserve) external onlyOwner onlySupportedAsset(asset) {
        minReserve[asset] = newMinReserve;
        emit MinReserveUpdated(asset, newMinReserve);
    }

    /**
     * @notice Set bot executor address
     * @param newBotExecutor Address of the new bot executor
     */
    function setBotExecutor(address newBotExecutor) external onlyOwner {
        botExecutor = newBotExecutor;
        emit BotExecutorUpdated(newBotExecutor);
    }

    /**
     * @notice Set price oracle address
     * @param newPriceOracle Address of the new price oracle
     */
    function setPriceOracle(address newPriceOracle) external onlyOwner {
        require(newPriceOracle != address(0), "Vault: invalid oracle");
        priceOracle = PriceOracle(newPriceOracle);
        emit PriceOracleUpdated(newPriceOracle);
    }


    /**
     * @notice Pause the vault (blocks deposits and withdrawals)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the vault
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EMERGENCY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Emergency token rescue for tokens accidentally sent to the vault
     * @param token Address of the token to rescue
     * @param to Recipient address
     * @param amount Amount to rescue
     */
    function rescueToken(address token, address to, uint amount) external onlyOwner {
        require(to != address(0), "Vault: invalid recipient");
        bool success = IERC20(token).transfer(to, amount);
        require(success, "Vault: transfer failed");
    }
}
