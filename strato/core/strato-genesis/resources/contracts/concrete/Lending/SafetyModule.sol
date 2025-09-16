import "./LendingPool.sol";
import "./LendingRegistry.sol";
import "./LiquidityPool.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/// @title SafetyModule (clean, 4626-lite)
/// @notice Holds USDST and issues non-transferable "shares" (sUSDST) via internal accounting.
///         - Rewards in USDST via notifyReward() raise price (exchangeRate).
///         - coverShortfall() transfers USDST to LendingPool and writes down system debt; price drops.
///         - Cooldown + unstake window enforce exit discipline.
///         - No Pausable/ReentrancyGuard. Assumes USDST is a well-behaved ERC20.

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

    // ─── Core
    LendingRegistry public lendingRegistry;
    LendingPool public  lendingPool;
    LiquidityPool public liquidityPool;
    TokenFactory public tokenFactory;
    address public  asset;   // USDST
    address public  sToken;  // sUSDST (ERC-20)

    // Cooldown mechanics
    uint public COOLDOWN_SECONDS = 259200;
    uint public UNSTAKE_WINDOW  = 172800;
    mapping(address => uint) public cooldownStart; // 0 = not cooling

    // Policy
    uint public MAX_SLASH_BPS = 3000; // 30% per event

    constructor(address _lendingRegistry, address _tokenFactory, address _owner) Ownable(_owner) {
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

    /// @notice Pull latest endpoints from registry and cache them.
    /// @dev Validates that LendingPool.borrowableAsset() matches cached (or initializes if first time).
    function syncFromRegistry() external onlyOwner {
        _syncFromRegistry();
    }

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
    function totalAssets() public view returns (uint) { return IERC20(asset).balanceOf(address(this)); }
    function totalShares() public view returns (uint) { return IERC20(sToken).totalSupply(); }
    function exchangeRate() public view returns (uint) {
        uint s = totalShares();
        if (s == 0) return 1e18;
        return (totalAssets() * 1e18) / s;
    }
    function previewStake(uint assetsIn) external view returns (uint) {
        require(assetsIn > 0, "SM:zero");
        uint s = totalShares();
        uint a = totalAssets();
        return s == 0 ? assetsIn : (assetsIn * s) / a;
    }
    function previewRedeem(uint sharesIn) external view returns (uint) {
        require(sharesIn > 0, "SM:zero");
        return (sharesIn * totalAssets()) / totalShares();
    }

    // ─────────────────────────────────────────
    // User actions

    /// @notice Stake `assetsIn` USDST, minting sUSDST. Uses balance-delta minting.
    function stake(uint assetsIn, uint minSharesOut) external onlyActiveToken(asset) onlyActiveToken(sToken) returns (uint sharesOut) {
        require(assetsIn > 0, "SM:zero");
        uint s = totalShares();
        uint beforeBal = totalAssets();

        // Initial-donation guard
        if (s == 0) require(beforeBal == 0, "SM:init stray funds");

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

    function startCooldown() external {
        require(IERC20(sToken).balanceOf(msg.sender) > 0, "SM:no shares");
        uint start = block.timestamp;
        cooldownStart[msg.sender] = start;
        emit UnstakeCooldown(msg.sender, start, start + COOLDOWN_SECONDS);
    }

    /// @notice Redeem `sharesIn` sUSDST for USDST to `to`. Caller must hold the shares (i.e., withdraw from Chef first).
    function redeem(uint sharesIn, uint minAssetsOut, address to) external returns (uint assetsOut) {
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
        IERC20(asset).transfer(to, assetsOut);

        if (IERC20(sToken).balanceOf(msg.sender) == 0) cooldownStart[msg.sender] = 0;

        emit Redeemed(msg.sender, sharesIn, assetsOut);
    }

    // ─────────────────────────────────────────
    // Rewards / Shortfall
    // ─────────────────────────────────────────
    function notifyReward(uint amount) external onlyOwner {
        require(amount > 0, "SM:zero");
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        emit RewardNotified(amount);
    }

    function coverShortfall(uint amount) external onlyOwner {
        require(amount > 0, "SM:zero");
        uint ta = totalAssets();
        require(amount <= ta, "SM:>assets");
        uint maxSlash = (ta * MAX_SLASH_BPS) / 10000;
        require(amount <= maxSlash, "SM:>maxSlash");

        IERC20(asset).transfer(address(liquidityPool), amount);
        lendingPool.coverShortfall(amount);

        emit ShortfallCovered(amount);
    }

    // ─────────────────────────────────────────
    // Admin
    function setParams(uint cooldown, uint window, uint maxSlashBps) external onlyOwner {
        require(cooldown > 0 && window > 0, "SM:bad params");
        require(maxSlashBps <= 10000, "SM:bad slash");
        COOLDOWN_SECONDS = cooldown;
        UNSTAKE_WINDOW = window;
        MAX_SLASH_BPS = maxSlashBps;
        emit ParamsUpdated(cooldown, window, maxSlashBps);
    }

    function setTokens(address _sToken, address _asset) external onlyOwner {
        require(_sToken != address(0), "Invalid sToken address");
        require(_asset != address(0), "Invalid underlyingAsset address");
        sToken = _sToken;
        asset = _asset;
        emit TokensUpdated(_asset, _sToken);
    }

    function rescueToken(address token, address to, uint amount) external onlyOwner {
        require(token != address(asset), "SM:no USDST rescue");
        IERC20(token).transfer(to, amount);
    }
}