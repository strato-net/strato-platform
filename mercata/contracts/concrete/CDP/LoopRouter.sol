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

/// @notice Marker for the engine->borrower flash callback. Dispatch happens
/// via `address(borrower).call("onFlashLoan", …)` in SolidVM so this interface
/// is documentation — it identifies implementers by grep.
interface IFlashLoanBorrower {
    function onFlashLoan(address asset, uint amount) external;
}

contract record LoopRouter is Ownable {
    CDPRegistry public registry;

    // Monotonic flash-call version. Bumped on every `leverageUp`; `onFlashLoan`
    // requires `_flashCtx.version == _flashVersion` so a stale or unprimed
    // context fails loudly instead of being silently consumed.
    uint256 private _flashVersion;

    // ─────────────────── Flash-loan reentrancy context ───────────────────
    // SolidVM-friendly alternative to `abi.encode`/`abi.decode`: the caller
    // writes the full flash context into private storage right before
    // `engine.flashMint` fires, and `onFlashLoan` reads it back. Invalidated
    // at the end of every flash by setting `version = 0`.
    struct FlashContext {
        uint256 version;
        address user;
        uint userCollateral;
        address poolAddress;
        uint poolType;
        uint coinI;
        uint coinJ;
        uint maxSlippageBps;
        uint deadline;
    }
    FlashContext private _flashCtx;

    event LeveragedUp(
        address indexed user,
        address indexed asset,
        uint amountIn,
        uint totalCollateral,
        uint totalDebt
    );

    event TokensRescued(address indexed token, address indexed to, uint amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _registry) external onlyOwner {
        require(_registry != address(0), "LoopRouter: invalid registry");
        registry = CDPRegistry(_registry);
    }

    function _freshRate(CDPEngine engine, address asset) internal view returns (uint) {
        (uint ra,,) = engine.collateralGlobalStates(asset);
        require(ra > 0, "LoopRouter: rate not initialized");
        return ra;
    }

    // ─────────────────── Single-shot flash leverage ───────────────────
    function leverageUp(
        address asset,
        uint amount,
        uint targetNewDebt,
        uint minFinalCollateral,
        address poolAddress,
        uint poolType,
        uint coinI,
        uint coinJ,
        uint maxSlippageBps,
        uint deadline
    ) external returns (uint totalCollateral, uint totalDebt) {
        require(amount > 0, "LoopRouter: invalid amount");
        require(targetNewDebt > 0, "LoopRouter: target debt zero");
        require(maxSlippageBps <= 1000, "LoopRouter: slippage > 10%");
        require(block.timestamp <= deadline, "LoopRouter: expired");

        CDPEngine engine = registry.cdpEngine();
        address usdst = address(registry.usdst());

        if (poolType == 0) {
            Pool p = Pool(poolAddress);
            bool isAToB = (coinI == 0);
            address tokenIn  = isAToB ? address(p.tokenA()) : address(p.tokenB());
            address tokenOut = isAToB ? address(p.tokenB()) : address(p.tokenA());
            require(tokenIn == usdst && tokenOut == asset, "LoopRouter: pool token mismatch");
        } else if (poolType == 1) {
            StablePool sp = StablePool(poolAddress);
            require(address(sp.coins(coinI)) == usdst, "LoopRouter: coinI must be USDST");
            require(address(sp.coins(coinJ)) == asset, "LoopRouter: coinJ must be asset");
        } else {
            revert("LoopRouter: invalid poolType");
        }

        // Pull user collateral in before entering the callback so the
        // deposit inside onFlashLoan owns it.
        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "LoopRouter: transfer failed");

        // Prime the flash context with a unique version token so stale or
        // unprimed reads in `onFlashLoan` fail `version` equality.
        ++_flashVersion;
        _flashCtx.version = _flashVersion;
        _flashCtx.user = msg.sender;
        _flashCtx.userCollateral = amount;
        _flashCtx.poolAddress = poolAddress;
        _flashCtx.poolType = poolType;
        _flashCtx.coinI = coinI;
        _flashCtx.coinJ = coinJ;
        _flashCtx.maxSlippageBps = maxSlippageBps;
        _flashCtx.deadline = deadline;

        engine.flashMint(address(this), asset, targetNewDebt);

        // Invalidate the ctx — any future stale read fails the version check.
        _flashCtx.version = 0;

        uint rateAcc = _freshRate(engine, asset);
        (uint finalColl, uint finalScaledDebt) = engine.vaults(msg.sender, asset);
        totalCollateral = finalColl;
        totalDebt = finalScaledDebt * rateAcc / 1e27;

        require(totalCollateral >= minFinalCollateral, "LoopRouter: final collateral below min");
        require(IERC20(asset).balanceOf(address(this)) == 0, "LoopRouter: asset residue");
        require(IERC20(usdst).balanceOf(address(this)) == 0, "LoopRouter: usdst residue");

        emit LeveragedUp(msg.sender, asset, amount, totalCollateral, totalDebt);
        return (totalCollateral, totalDebt);
    }

    /// @notice Engine → router flash callback. Swaps the flashed USDST for
    ///         collateral, deposits total collateral on the user's behalf,
    ///         then mints the permanent debt that will repay the flash.
    /// @dev Gated to the engine we resolve from the registry; any direct call
    ///      reverts with "not engine". The primed `_flashCtx.version` must
    ///      equal `_flashVersion` so stale / unprimed contexts fail loudly.
    function onFlashLoan(address asset, uint amount) external {
        CDPEngine engine = registry.cdpEngine();
        require(msg.sender == address(engine), "LoopRouter: not engine");
        require(_flashCtx.version != 0 && _flashCtx.version == _flashVersion, "LoopRouter: stale flash ctx");

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
        require(IERC20(usdst).approve(poolAddress, amount), "LoopRouter: usdst approve failed");
        uint expectedOut = poolType == 0
            ? Pool(poolAddress).quoteSwap(coinI == 0, amount)
            : StablePool(poolAddress).quoteSwap(coinI, coinJ, amount);
        require(expectedOut > 0, "LoopRouter: zero quote");
        uint minOut = expectedOut * (10000 - maxSlippageBps) / 10000;
        uint received = poolType == 0
            ? Pool(poolAddress).swap(coinI == 0, amount, minOut, deadline)
            : StablePool(poolAddress).exchange(coinI, coinJ, amount, minOut, address(this));

        // 2) Deposit user's collateral + swap output into the vault on the
        //    user's behalf, then mint the permanent debt (CR check fires).
        uint totalColl = userCollateral + received;
        address vaultAddr = address(registry.cdpVault());
        require(IERC20(asset).approve(vaultAddr, totalColl), "LoopRouter: coll approve failed");
        engine.depositFor(address(this), user, asset, totalColl);
        engine.mintFor(address(this), user, asset, amount);
        // The `amount` of USDST freshly minted by mintFor now sits in the
        // router, balancing the flashed supply so the engine can burn it.
    }

    function rescueTokens(address token, address to, uint amount) external onlyOwner {
        require(to != address(0), "LoopRouter: invalid to");
        require(token != address(registry.usdst()), "LoopRouter: cannot rescue USDST");
        require(!registry.cdpEngine().isSupportedAsset(token), "LoopRouter: cannot rescue collateral asset");
        require(IERC20(token).transfer(to, amount), "LoopRouter: rescue transfer failed");
        emit TokensRescued(token, to, amount);
    }
}
