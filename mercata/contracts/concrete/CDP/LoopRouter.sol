// LoopRouter — single-shot CDP leverage via CDPEngine.flashMint.
// Caller supplies the exact new debt (`targetNewDebt`) computed off-chain
// against the current pool/oracle state. The engine flash-mints that amount
// of USDST to the router; the router swaps it for collateral, deposits
// `userCollateral + swapOut` on the user's behalf, then calls `mintFor`
// (which fires the CR check) to materialise the permanent debt. The D*
// USDST produced by `mintFor` repays the flash; the engine burns it.
// Net USDST supply change = +targetNewDebt.
//
// CDPEngine.depositFor / mintFor / flashMint use onlyOwner which falls
// through to AdminRegistry whitelist — router must be whitelisted.
// Supports constant-product Pool and StablePool; `onFlashLoan` branches
// by `poolType` for quoting and swapping.

import "../Tokens/Token.sol";
import "./CDPEngine.sol";
import "./CDPVault.sol";
import "./CDPRegistry.sol";
import "../Pools/Pool.sol";
import "../Pools/StablePool.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record LoopRouter is Ownable {
    CDPRegistry public registry;

    // ─────────────────── Flash-loan reentrancy context ───────────────────
    // SolidVM-friendly alternative to `abi.encode`/`abi.decode`: the caller
    // writes the full flash context into private storage right before
    // `engine.flashMint` fires, and `onFlashLoan` reads it back. Cleared at
    // the end of every flash to make residue impossible to consume later.
    struct FlashContext {
        address user;
        uint userCollateral;
        address poolAddress;
        uint poolType;
        uint coinI;
        uint coinJ;
        uint maxSlippageBps;
        uint deadline;
        bool active;
    }
    FlashContext private _flashCtx;

    event LeveragedUp(
        address indexed user,
        address indexed asset,
        uint amountIn,
        uint totalCollateral,
        uint totalDebt
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _registry) external onlyOwner {
        require(_registry != address(0), "LoopRouter: invalid registry");
        registry = CDPRegistry(_registry);
    }

    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "invalid registry");
        registry = CDPRegistry(_registry);
    }

    function _freshRate(CDPEngine engine, address asset) internal view returns (uint) {
        (uint ra,,) = engine.collateralGlobalStates(asset);
        return ra == 0 ? 1e27 : ra;
    }

    // ─────────────────── Single-shot flash leverage ───────────────────
    function leverageUp(
        address asset,
        uint amount,
        uint targetNewDebt,
        address poolAddress,
        uint poolType,
        uint coinI,
        uint coinJ,
        uint maxSlippageBps,
        uint deadline
    ) external returns (uint totalCollateral, uint totalDebt) {
        require(amount > 0, "invalid amount");
        require(targetNewDebt > 0, "target debt zero");
        require(maxSlippageBps <= 1000, "slippage > 10%");
        require(block.timestamp <= deadline, "expired");
        require(!_flashCtx.active, "flash reentry");

        CDPEngine engine = registry.cdpEngine();
        address usdst = address(registry.usdst());

        if (poolType == 0) {
            Pool p = Pool(poolAddress);
            bool isAToB = (coinI == 0);
            address tokenIn  = isAToB ? address(p.tokenA()) : address(p.tokenB());
            address tokenOut = isAToB ? address(p.tokenB()) : address(p.tokenA());
            require(tokenIn == usdst && tokenOut == asset, "pool token mismatch");
        } else if (poolType == 1) {
            StablePool sp = StablePool(poolAddress);
            require(address(sp.coins(coinI)) == usdst, "coinI must be USDST");
            require(address(sp.coins(coinJ)) == asset, "coinJ must be asset");
        } else {
            revert("invalid poolType");
        }

        // Pull user collateral in before entering the callback so the
        // deposit inside onFlashLoan owns it.
        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "transfer failed");

        // Prime the flash context; onFlashLoan reads this back.
        _flashCtx.user = msg.sender;
        _flashCtx.userCollateral = amount;
        _flashCtx.poolAddress = poolAddress;
        _flashCtx.poolType = poolType;
        _flashCtx.coinI = coinI;
        _flashCtx.coinJ = coinJ;
        _flashCtx.maxSlippageBps = maxSlippageBps;
        _flashCtx.deadline = deadline;
        _flashCtx.active = true;

        engine.flashMint(address(this), asset, targetNewDebt);

        // Clear context — belt-and-suspenders even though the engine
        // guarantees onFlashLoan ran exactly once before returning.
        delete _flashCtx.user;
        delete _flashCtx.userCollateral;
        delete _flashCtx.poolAddress;
        delete _flashCtx.poolType;
        delete _flashCtx.coinI;
        delete _flashCtx.coinJ;
        delete _flashCtx.maxSlippageBps;
        delete _flashCtx.deadline;
        delete _flashCtx.active;

        uint rateAcc = _freshRate(engine, asset);
        (uint finalColl, uint finalScaledDebt) = engine.vaults(msg.sender, asset);
        totalCollateral = finalColl;
        totalDebt = finalScaledDebt * rateAcc / 1e27;

        emit LeveragedUp(msg.sender, asset, amount, totalCollateral, totalDebt);
        return (totalCollateral, totalDebt);
    }

    /// @notice Engine → router flash callback. Swaps the flashed USDST for
    ///         collateral, deposits total collateral on the user's behalf,
    ///         then mints the permanent debt that will repay the flash.
    /// @dev Gated to the engine we resolve from the registry; any direct call
    ///      reverts with "not engine". Context is the `_flashCtx` set by
    ///      `leverageUp` just before the engine call.
    function onFlashLoan(address asset, uint amount) external {
        CDPEngine engine = registry.cdpEngine();
        require(msg.sender == address(engine), "not engine");
        require(_flashCtx.active, "no flash context");

        address user = _flashCtx.user;
        uint userCollateral = _flashCtx.userCollateral;
        address poolAddress = _flashCtx.poolAddress;
        // Force value-copies out of storage. SolidVM carries a storage
        // reference otherwise, which StablePool.quoteSwap rejects when the
        // index is used for `xp[i]` array access (SReference != uint).
        uint poolType = _flashCtx.poolType + 0;
        uint coinI = _flashCtx.coinI + 0;
        uint coinJ = _flashCtx.coinJ + 0;
        uint maxSlippageBps = _flashCtx.maxSlippageBps + 0;
        uint deadline = _flashCtx.deadline + 0;

        address usdst = address(registry.usdst());

        // 1) Swap the full flash amount USDST → collateral.
        require(IERC20(usdst).approve(poolAddress, amount), "usdst approve failed");
        uint expectedOut = poolType == 0
            ? Pool(poolAddress).quoteSwap(coinI == 0, amount)
            : StablePool(poolAddress).quoteSwap(coinI, coinJ, amount);
        uint minOut = expectedOut * (10000 - maxSlippageBps) / 10000;
        if (minOut == 0) minOut = 1;
        uint received = poolType == 0
            ? Pool(poolAddress).swap(coinI == 0, amount, minOut, deadline)
            : StablePool(poolAddress).exchange(coinI, coinJ, amount, minOut, address(this));

        // 2) Deposit user's collateral + swap output into the vault on the
        //    user's behalf, then mint the permanent debt (CR check fires).
        uint totalColl = userCollateral + received;
        address vaultAddr = address(registry.cdpVault());
        require(IERC20(asset).approve(vaultAddr, totalColl), "coll approve failed");
        engine.depositFor(address(this), user, asset, totalColl);
        engine.mintFor(address(this), user, asset, amount);
        // The `amount` of USDST freshly minted by mintFor now sits in the
        // router, balancing the flashed supply so the engine can burn it.
    }

    function rescueTokens(address token, address to, uint amount) external onlyOwner {
        require(to != address(0), "invalid to");
        require(token != address(registry.usdst()), "cannot rescue USDST");
        require(!registry.cdpEngine().isSupportedAsset(token), "cannot rescue collateral asset");
        require(IERC20(token).transfer(to, amount), "transfer failed");
    }
}
