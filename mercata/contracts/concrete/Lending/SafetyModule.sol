import "./LendingPool.sol";
import "./LendingRegistry.sol";
import "./LiquidityPool.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Rewards/RewardsChef.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/// @title SafetyModule (clean, 4626-lite)
/// @notice Holds USDST and issues sUSDST tokens via internal accounting.
///         - Rewards in USDST via notifyReward() raise price (exchangeRate).
///         - coverShortfall() transfers USDST to LendingPool and writes down system debt; price drops.
///         - Cooldown + unstake window enforce exit discipline.

struct RewardsChefInfo {
    address rewardsChef;
    uint256 poolId;
}

contract record SafetyModule is Ownable {
    // ─── Events
    event Staked(address indexed user, uint assetsIn, uint sharesOut);
    event UnstakeCooldown(address indexed user, uint start, uint end);
    event Redeemed(address indexed user, uint sharesIn, uint assetsOut);
    event RewardNotified(uint amount);
    event ShortfallCovered(uint amount);
    event ParamsUpdated(uint cooldown, uint window, uint maxSlashBps);
    event TokensUpdated(address _asset, address _sToken);
    event TokenFactoryUpdated(address _tokenFactory);
    event EndpointsSynced(address _lendingPool, address _liquidityPool, address newAsset);
    event RegistryUpdated(address _lendingRegistry);
    event RewardsChefUpdated(address _rewardsChef, uint256 _poolId);

    // ─── Core
    LendingRegistry public lendingRegistry;
    LendingPool public  lendingPool;
    LiquidityPool public liquidityPool;
    TokenFactory public tokenFactory;
    RewardsChefInfo public record rewardsChefInfo;
    address public  asset;   // USDST
    address public  sToken;  // sUSDST (ERC-20)

    // Cooldown mechanics
    uint public COOLDOWN_SECONDS = 259200;
    uint public UNSTAKE_WINDOW  = 172800;
    mapping(address => uint) public record cooldownStart; // 0 = not cooling

    // Policy
    uint public MAX_SLASH_BPS = 3000; // 30% per event

    constructor(address _owner) Ownable(_owner) { }

    function initialize(address _lendingRegistry, address _tokenFactory) external onlyOwner {
        // @dev important: must be set here for proxied instances; ensure consistency with desired initial values
        COOLDOWN_SECONDS = 259200;
        UNSTAKE_WINDOW = 172800;
        MAX_SLASH_BPS = 3000;

        require(_lendingRegistry != address(0)  && _tokenFactory != address(0), "SM:zero addr");
        lendingRegistry = LendingRegistry(_lendingRegistry);
        tokenFactory = TokenFactory(_tokenFactory);
    }

    modifier onlyActiveToken(address token) {
        require(token != address(0) && tokenFactory.isTokenActive(token), "Invalid or inactive token");
        _;
    }

    // ─────────────────────────────────────────
    // Registry syncing (admin)

    function setRegistry(address r) external onlyOwner {
        require(r != address(0), "SM:reg=0");
        lendingRegistry = LendingRegistry(r);
        emit RegistryUpdated(r);
    }

    function setTokenFactory(address _tokenFactory) external onlyOwner {
        require(_tokenFactory != address(0), "SM:reg=0");
        tokenFactory = TokenFactory(_tokenFactory);
        emit TokenFactoryUpdated(_tokenFactory);
    }

    /// @notice Pull latest values from registry and cache them.
    /// @dev Validates that LendingPool.borrowableAsset() matches cached (or initializes if first time).
    function syncFromRegistry() external onlyOwner {
        _syncFromRegistry();
    }

    /// @dev call this before setTokens()
    /// @dev call this after the LendingPool configuration, particularly `poolConfigurator.setBorrowableAsset(USDST)`
    function _syncFromRegistry() internal {
        address _lendingPool = lendingRegistry.getLendingPool();
        address _liquidityPool = lendingRegistry.getLiquidityPool();
        require(_lendingPool != address(0) && _liquidityPool != address(0), "SM:bad registry addrs");

        // Derive asset from LendingPool
        address newAsset = LendingPool(_lendingPool).borrowableAsset();
        require(newAsset != address(0), "SM:asset=0");

        // If already initialized, require asset to stay consistent
        if (address(asset) != address(0)) {
            require(newAsset == address(asset), "SM:asset mismatch");
        } else {
            asset = newAsset;
        }

        lendingPool   = LendingPool(_lendingPool);
        liquidityPool = LiquidityPool(_liquidityPool);

        emit EndpointsSynced(_lendingPool, _liquidityPool, newAsset);
    }


    // ─────────────────────────────────────────
    // Views / math
    // Vault TVL in underlying (pulls live ERC20 balance)
    function totalAssets() public view returns (uint)
    {
        require(asset != address(0), "SM:asset not set");
        return IERC20(asset).balanceOf(address(this));
    }

    // Total shares outstanding (assumes sToken implements ERC20 totalSupply)
    function totalShares() public view returns (uint)
    {
        require(sToken != address(0), "SM:sToken not set");
        return IERC20(sToken).totalSupply();
    }

    /// @notice Current sUSDST price in USDST units (1e18 = 1.0).
    /// @dev
    ///  - Reverts if the module is not initialized (missing asset/sToken).
    ///  - If no shares exist yet, returns 1e18 (defines the initial price).
    ///  - Floors on division (rounds down), as with standard ERC-4626.
    /// @return rate Scaled 1e18 exchange rate = totalAssets / totalShares (or 1e18 when shares==0).
    function exchangeRate() public view returns (uint) {
        uint s = totalShares();
        if (s == 0) return 1e18;
        return (totalAssets() * 1e18) / s;
    }

    /// @notice Pure estimate of shares minted for depositing `assetsIn` right now.
    /// @dev
    ///  - Uses the CURRENT ratio only; ignores transfer fees and donation guard.
    ///  - If no shares exist yet, preview equals `assetsIn` (initial 1:1).
    ///  - Reverts if module is not initialized or `assetsIn == 0`.
    ///  - Actual mint uses balance-delta and may be LOWER when the token is fee-on-transfer.
    /// @param assetsIn Amount of USDST the user intends to stake.
    /// @return sharesOut Estimated shares that would be minted at the current ratio.
    function previewStake(uint assetsIn) external view returns (uint) {
        require(assetsIn > 0, "SM:zero");
        uint s = totalShares();
        uint a = totalAssets();
        if (s == 0) return assetsIn;           // initial 1:1
        require(a > 0, "SM:price=0");          // shares exist but vault has no assets
        return (assetsIn * s) / a;             // floor by design
    }

    /// @notice Pure estimate of USDST returned for redeeming `sharesIn` right now.
    /// @dev
    ///  - Uses the CURRENT ratio only; ignores cooldown/window and caller’s balance.
    ///  - Reverts if module is not initialized, `sharesIn == 0`, or totalShares == 0.
    ///  - Floors on division (rounds down), matching actual redeem semantics.
    /// @param sharesIn Amount of sUSDST the user intends to redeem.
    /// @return assetsOut Estimated USDST that would be returned at the current ratio.
    function previewRedeem(uint sharesIn) external view returns (uint) {
        require(sharesIn > 0, "SM:zero");
        uint s = totalShares();
        require(s > 0, "SM:no shares");
        return (sharesIn * totalAssets()) / s;
    }

    // ─────────────────────────────────────────
    // User actions

    /// @notice Stake `assetsIn` USDST; mints shares using balance-delta to account for fee-on-transfer tokens.
    /// @dev Guards:
    ///  - Active underlying (prevents deposits into offboarded market)
    ///  - Donation guard on first mint (no pre-loaded funds)
    ///  - Slippage (minSharesOut)
    function stake(uint assetsIn, uint minSharesOut) external onlyActiveToken(asset) onlyActiveToken(sToken) returns (uint sharesOut) {
        require(assetsIn > 0, "SM:zero");
        uint s = totalShares();
        uint beforeBal = totalAssets();

        if (s == 0) {
            require(beforeBal == 0, "SM:init stray funds"); // donation guard
        } else {
            require(beforeBal > 0, "SM:price=0");  // prevent (s>0, a==0)
        }

        IERC20(asset).transferFrom(msg.sender, address(this), assetsIn);
        uint delta = totalAssets() - beforeBal;
        require(delta > 0, "SM:no delta");

        sharesOut = (s == 0) ? delta : (delta * s) / beforeBal;
        require(sharesOut > 0, "SM:dust");
        require(sharesOut >= minSharesOut, "SM:slippage");

        Token(sToken).mint(msg.sender, sharesOut);

        // Reset cooldown on new stake
        cooldownStart[msg.sender] = 0;

        emit Staked(msg.sender, delta, sharesOut);
    }

    /// @notice Start cooldown. After COOLDOWN_SECONDS elapse, you have UNSTAKE_WINDOW to redeem.
    /// @dev Overwrites previous starts. Checks both wallet-held shares and RewardsChef staked shares.
    function startCooldown() external {
        uint walletBalance = IERC20(sToken).balanceOf(msg.sender);
        uint stakedBalance = 0;

        // Check RewardsChef staked balance if configured
        if (rewardsChefInfo.rewardsChef != address(0)) {
            RewardsChef chef = RewardsChef(rewardsChefInfo.rewardsChef);
            stakedBalance = chef.getBalance(rewardsChefInfo.poolId, msg.sender);
        }

        require(walletBalance > 0 || stakedBalance > 0, "SM:no shares");
        uint start = block.timestamp;
        cooldownStart[msg.sender] = start;
        emit UnstakeCooldown(msg.sender, start, start + COOLDOWN_SECONDS);
    }

    /// @notice Redeem shares for USDST to `to` after cooldown and within unstake window.
    /// @dev Caller must hold the shares in wallet (withdraw from Chef first).
    function redeem(uint sharesIn, uint minAssetsOut) external returns (uint assetsOut) {
        require(sharesIn > 0, "SM:zero");
        require(IERC20(sToken).balanceOf(msg.sender) >= sharesIn, "SM:not holder");

        uint start = cooldownStart[msg.sender];
        require(start > 0, "SM:no cooldown");
        require(block.timestamp >= start + COOLDOWN_SECONDS, "SM:cooling");
        require(block.timestamp <= start + COOLDOWN_SECONDS + UNSTAKE_WINDOW, "SM:window over");

        uint a = totalAssets();
        uint s = totalShares();
        assetsOut = (sharesIn * a) / s;
        require(assetsOut > 0, "SM:dust");
        require(assetsOut >= minAssetsOut, "SM:slippage");

        // burn then transfer
        Token(sToken).burn(msg.sender, sharesIn);
        IERC20(asset).transfer(msg.sender, assetsOut);

        if (IERC20(sToken).balanceOf(msg.sender) == 0) cooldownStart[msg.sender] = 0;

        emit Redeemed(msg.sender, sharesIn, assetsOut);
    }

    // ─────────────────────────────────────────
    // Rewards / Shortfall
    // ─────────────────────────────────────────
    /// @notice Pull USDST from owner and treat as rewards (price ↑ for all holders).
    function notifyReward(uint amount) external onlyOwner {
        require(amount > 0, "SM:zero");
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        emit RewardNotified(amount);
    }

    /// @notice Slash vault to cover protocol shortfall.
    /// @dev Data plane: send USDST to LiquidityPool.
    /// Control plane: tell LendingPool to consume badDebt (accounting).

    function coverShortfall(uint256 amount) external onlyOwner returns (uint256 covered) {
        require(amount > 0, "SM:zero");

        // Live caps
        uint256 ta        = totalAssets();                         // SM TVL
        uint256 bd        = lendingPool.badDebt();                 // live bad debt in base units
        require(bd > 0, "SM:no bad debt");

        uint256 maxSlash  = (ta * MAX_SLASH_BPS) / 10000;

        // Compute the actual amount we are willing & able to cover
        covered = amount;
        if (covered > ta)        covered = ta;        // cannot send more than vault assets
        if (covered > maxSlash)  covered = maxSlash;  // per-event slash cap
        if (covered > bd)        covered = bd;        // don't overfund beyond bad debt

        require(covered > 0, "SM:nothing to cover");

        // Push exactly what will be consumed, then notify LendingPool
        IERC20(asset).transfer(address(liquidityPool), covered);
        lendingPool.coverShortfall(covered);

        emit ShortfallCovered(covered);
    }

    // ─────────────────────────────────────────
    // Admin

    /// @notice Update cooldown/window and per-event slash cap.
    function setParams(uint cooldown, uint window, uint maxSlashBps) external onlyOwner {
        require(cooldown > 0 && window > 0, "SM:bad params");
        require(maxSlashBps <= 10000, "SM:bad slash");
        COOLDOWN_SECONDS = cooldown;
        UNSTAKE_WINDOW = window;
        MAX_SLASH_BPS = maxSlashBps;
        emit ParamsUpdated(cooldown, window, maxSlashBps);
    }

    /// @notice set the tokens - typically one-time
    /// @dev call this after syncFromRegistry() so that lendingPool is set
    function setTokens(address _sToken, address _asset) external onlyOwner {
        require(_sToken != address(0), "Invalid sToken address");
        require(_asset != address(0), "Invalid underlyingAsset address");
        // Ensure SM protects the same asset as LendingPool
        require(LendingPool(address(lendingPool)).borrowableAsset() == _asset, "SM:asset mismatch");
        // Avoid accidental equality (receipt token must differ from underlying)
        require(_sToken != _asset, "SM:equal tokens");

        sToken = _sToken;
        asset = _asset;
        emit TokensUpdated(_asset, _sToken);
    }

    /// @notice Set the RewardsChef reference and poolId for checking staked balances
    /// @dev Used to check both wallet and staked balances when starting cooldown.
    ///      Note: Owner should ensure the pool exists and uses sToken as LP token.
    function setRewardsChef(address _rewardsChef, uint256 _poolId) external onlyOwner {
        require(_rewardsChef != address(0), "SM:zero addr");
        rewardsChefInfo.rewardsChef = _rewardsChef;
        rewardsChefInfo.poolId = _poolId;
        emit RewardsChefUpdated(_rewardsChef, _poolId);
    }

    /// @notice Rescue stray tokens (not the vault asset).
    function rescueToken(address token, address to, uint amount) external onlyOwner {
        require(token != address(asset), "SM:no USDST rescue");
        IERC20(token).transfer(to, amount);
    }
}
