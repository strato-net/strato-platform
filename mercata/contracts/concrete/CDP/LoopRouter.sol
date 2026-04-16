// LoopRouter — bounded-approximate CDP leverage via binary search simulation.
// Finds target debt by simulating the deposit-mint-swap loop path
// with virtual reserves, then executes the same path on-chain.
// Approximation controlled by: binary search tolerance (~0.1%),
// DUST threshold (minimum meaningful loop increment), pool rounding,
// and MAX_LOOPS iteration limit. Positions below DUST are intentionally
// unsupported — DUST defines the router's minimum operable increment.
// Positions owned by user, not router. Router holds no funds between calls.
// CDPEngine.depositFor/mintFor use onlyOwner which falls through to
// AdminRegistry whitelist — router must be whitelisted, not the owner.
// Scope: constant-product Pool only (not StablePool).
// Simulation (_simulateSwap) must mirror Pool's swap math exactly;
// any future Pool formula change requires a matching router update.

import "../Tokens/Token.sol";
import "../Lending/PriceOracle.sol";
import "./CDPEngine.sol";
import "./CDPVault.sol";
import "./CDPRegistry.sol";
import "../Pools/Pool.sol";
import "../Pools/PoolFactory.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record LoopRouter is Ownable {
    CDPRegistry public registry;

    uint public MAX_LOOPS;
    uint public WAD;
    uint public DUST;

    event LeveragedUp(
        address indexed user,
        address indexed asset,
        uint amountIn,
        uint totalCollateral,
        uint totalDebt,
        uint loops
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _registry) external onlyOwner {
        WAD = 1e18;
        MAX_LOOPS = 20;
        DUST = 1e6;
        require(_registry != address(0), "LoopRouter: invalid registry");
        registry = CDPRegistry(_registry);
    }

    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "invalid registry");
        registry = CDPRegistry(_registry);
    }

    function setMaxLoops(uint _maxLoops) external onlyOwner {
        require(_maxLoops >= 1 && _maxLoops <= 100, "invalid maxLoops");
        MAX_LOOPS = _maxLoops;
    }

    // ─────────────────── Pool fee helpers ───────────────────
    // Mirrors Pool._swapFeeRate() / Pool._lpSharePercent() fallback logic.

    function _getEffectiveFeeRate(Pool pool) internal view returns (uint) {
        uint rate = pool.swapFeeRate();
        if (rate > 0) return rate;
        return PoolFactory(pool.poolFactory()).swapFeeRate();
    }

    function _getEffectiveLpShare(Pool pool) internal view returns (uint) {
        uint share = pool.lpSharePercent();
        if (share > 0) return share;
        return PoolFactory(pool.poolFactory()).lpSharePercent();
    }

    // ─────────────────── Simulation ───────────────────

    function _simulateSwap(
        uint amountIn, uint Rin, uint Rout, uint feeRate, uint lpShare
    ) internal view returns (uint amountOut, uint newRin, uint newRout) {
        uint fee = amountIn * feeRate / 10000;
        uint lpFee = fee * lpShare / 10000;
        uint protocolFee = fee - lpFee;
        uint netInput = amountIn - fee;
        amountOut = netInput * Rout / (Rin + netInput);
        newRin = Rin + amountIn - protocolFee;
        newRout = Rout - amountOut;
    }

    function _simulateLoop(
        uint amount,
        uint candidateNewDebt,
        uint price,
        uint unitScale,
        uint minCR,
        uint Rin,
        uint Rout,
        uint feeRate,
        uint lpShare,
        uint existingColl,
        uint existingDebt
    ) internal view returns (uint totalCollateral, uint totalDebt, uint remainingDebt) {
        remainingDebt = candidateNewDebt;
        uint available = amount;
        uint vRin = Rin;
        uint vRout = Rout;
        totalCollateral = existingColl;
        totalDebt = existingDebt;

        for (uint i = 0; i < MAX_LOOPS; i++) {
            if (available < DUST || remainingDebt == 0) break;

            totalCollateral += available;
            available = 0;

            uint collValueUSD = totalCollateral * price / unitScale;
            uint maxBorrowable = collValueUSD * WAD / minCR;
            if (maxBorrowable <= totalDebt + 2) break;
            uint headroom = maxBorrowable - totalDebt - 2;

            uint mintAmt = remainingDebt < headroom ? remainingDebt : headroom;
            if (mintAmt < DUST) break;

            totalDebt += mintAmt;
            remainingDebt -= mintAmt;

            // Always swap minted USDST back to collateral — this is the core
            // of leverage. Without the swap, we just have debt with no extra exposure.
            (uint swapOut, uint nRin, uint nRout) = _simulateSwap(mintAmt, vRin, vRout, feeRate, lpShare);
            vRin = nRin;
            vRout = nRout;
            available = swapOut;
        }

        // Deposit any remaining collateral from the final swap
        if (available >= DUST) {
            totalCollateral += available;
        }
    }

    // Binary search for new debt that achieves targetLeverageWAD.
    // Returns 0 if no candidate converges within 0.1% leverage error.
    function _findExactDebt(
        uint amount,
        uint targetLeverageWAD,
        uint price,
        uint unitScale,
        uint minCR,
        uint Rin,
        uint Rout,
        uint feeRate,
        uint lpShare,
        uint existingColl,
        uint existingDebt
    ) internal view returns (uint) {
        uint E = amount * price / unitScale;

        uint high = E * (targetLeverageWAD - WAD) * 2 / targetLeverageWAD;
        if (high == 0) high = E;

        for (uint g = 0; g < 40; g++) {
            (uint tc, uint td, uint rem) = _simulateLoop(
                amount, high, price, unitScale, minCR,
                Rin, Rout, feeRate, lpShare, existingColl, existingDebt
            );
            if (rem > 0) break;
            uint cv = tc * price / unitScale;
            if (cv <= td) break;
            uint lev = cv * WAD / (cv - td);
            if (lev >= targetLeverageWAD) break;
            high = high * 2;
        }

        uint low = 0;
        uint bestD = 0;
        uint bestError = 2**256 - 1;

        for (uint iter = 0; iter < 100; iter++) {
            if (high <= low + 1) break;
            uint mid = (low + high) / 2;

            (uint totalColl, uint totalDebtSim, uint rem) = _simulateLoop(
                amount, mid, price, unitScale, minCR,
                Rin, Rout, feeRate, lpShare, existingColl, existingDebt
            );

            if (rem > 0) {
                high = mid;
                continue;
            }

            uint collValueUSD = totalColl * price / unitScale;
            if (collValueUSD <= totalDebtSim) {
                high = mid;
                continue;
            }

            uint actualLev = collValueUSD * WAD / (collValueUSD - totalDebtSim);
            uint error = actualLev > targetLeverageWAD
                ? actualLev - targetLeverageWAD
                : targetLeverageWAD - actualLev;

            if (error < bestError) {
                bestError = error;
                bestD = mid;
            }

            if (actualLev < targetLeverageWAD) {
                low = mid;
            } else {
                high = mid;
            }
        }

        if (bestError > WAD / 1000) return 0;

        return bestD;
    }

    // ─────────────────── Leverage execution ───────────────────

    function _freshRate(CDPEngine engine, address asset) internal view returns (uint) {
        (uint ra,,) = engine.collateralGlobalStates(asset);
        return ra == 0 ? 1e27 : ra;
    }

    function leverageUp(
        address asset,
        uint amount,
        uint targetLeverageWAD,
        address poolAddress,
        bool swapIsAToB,
        uint maxSlippageBps,
        uint deadline
    ) external returns (uint totalCollateral, uint totalDebt) {
        require(amount > 0, "invalid amount");
        require(targetLeverageWAD > WAD, "leverage <= 1x");
        require(maxSlippageBps <= 1000, "slippage > 10%");
        require(block.timestamp <= deadline, "expired");

        CDPEngine engine = registry.cdpEngine();
        address vaultAddr = address(registry.cdpVault());
        address usdst = address(registry.usdst());

        Pool pool = Pool(poolAddress);
        address poolTokenA = address(pool.tokenA());
        address poolTokenB = address(pool.tokenB());
        if (swapIsAToB) {
            require(poolTokenA == usdst && poolTokenB == asset, "pool token mismatch");
        } else {
            require(poolTokenB == usdst && poolTokenA == asset, "pool token mismatch");
        }

        (uint price, ) = registry.priceOracle().getAssetPriceWithTimestamp(asset);
        require(price > 0, "no price");

        (, uint minCR,,,, uint debtFloor, uint debtCeiling, uint unitScale,) = engine.collateralConfigs(asset);
        if (unitScale == 0) unitScale = WAD;
        require(minCR > WAD, "invalid minCR");

        uint LmaxWAD = minCR * WAD / (minCR - WAD);
        require(targetLeverageWAD <= LmaxWAD, "exceeds max leverage");

        // Accrue first so rateAccumulator is current. All subsequent
        // _accrue calls within this block are no-ops (dt=0).
        engine.accrue(asset);

        (uint existingColl, uint existingScaledDebt) = engine.vaults(msg.sender, asset);
        uint rateAcc = _freshRate(engine, asset);
        uint existingDebt = existingScaledDebt * rateAcc / 1e27;

        (, , uint totalScaledDebt) = engine.collateralGlobalStates(asset);
        uint assetDebtExisting = totalScaledDebt * rateAcc / 1e27;
        if (debtCeiling > 0) {
            require(assetDebtExisting < debtCeiling, "debt ceiling already reached");
        }

        // Snapshot balances before pulling user funds so sweep only returns
        // residual from this call, not stray balances from unrelated transfers.
        uint assetBalBefore = IERC20(asset).balanceOf(address(this));
        uint usdstBalBefore = IERC20(usdst).balanceOf(address(this));

        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "transfer failed");

        uint feeRate = _getEffectiveFeeRate(pool);
        uint lpShare = _getEffectiveLpShare(pool);
        uint Rin = swapIsAToB ? pool.tokenABalance() : pool.tokenBBalance();
        uint Rout = swapIsAToB ? pool.tokenBBalance() : pool.tokenABalance();

        uint targetNewDebt = _findExactDebt(
            amount, targetLeverageWAD, price, unitScale, minCR,
            Rin, Rout, feeRate, lpShare, existingColl, existingDebt
        );
        require(targetNewDebt > 0, "debt search failed");

        if (debtFloor > 0) {
            require(existingDebt + targetNewDebt >= debtFloor, "target debt below floor");
        }

        if (debtCeiling > 0) {
            require(assetDebtExisting + targetNewDebt <= debtCeiling, "would exceed debt ceiling");
        }

        uint remainingDebt = targetNewDebt;
        uint available = amount;
        uint loopsCompleted = 0;

        for (uint i = 0; i < MAX_LOOPS; i++) {
            if (available < DUST || remainingDebt == 0) break;

            IERC20(asset).approve(vaultAddr, available);
            engine.depositFor(address(this), msg.sender, asset, available);
            available = 0;

            // Re-read actual vault state (rate is already current from accrue)
            (uint vaultColl, uint vaultScaledDebt) = engine.vaults(msg.sender, asset);
            totalCollateral = vaultColl;
            totalDebt = vaultScaledDebt * rateAcc / 1e27;

            uint collValueUSD = totalCollateral * price / unitScale;
            uint maxBorrowable = collValueUSD * WAD / minCR;
            if (maxBorrowable <= totalDebt + 2) break;
            uint headroom = maxBorrowable - totalDebt - 2;

            uint mintAmt = remainingDebt < headroom ? remainingDebt : headroom;
            if (mintAmt < DUST) break;

            engine.mintFor(address(this), msg.sender, asset, mintAmt);

            // Re-read after mint (refresh rate in case _accrue updated it)
            rateAcc = _freshRate(engine, asset);
            (vaultColl, vaultScaledDebt) = engine.vaults(msg.sender, asset);
            totalCollateral = vaultColl;
            totalDebt = vaultScaledDebt * rateAcc / 1e27;
            uint newDebtSoFar = totalDebt > existingDebt ? totalDebt - existingDebt : 0;
            remainingDebt = targetNewDebt > newDebtSoFar ? targetNewDebt - newDebtSoFar : 0;

            loopsCompleted++;

            // Always swap minted USDST back to collateral — this is the core
            // of leverage. Without the swap, we just have debt with no extra exposure.
            uint inputReserve = swapIsAToB ? pool.tokenABalance() : pool.tokenBBalance();
            uint outputReserve = swapIsAToB ? pool.tokenBBalance() : pool.tokenABalance();
            uint swapFee = mintAmt * feeRate / 10000;
            uint netInput = mintAmt - swapFee;
            uint expectedOut = pool.getInputPrice(netInput, inputReserve, outputReserve);
            uint minOut = expectedOut * (10000 - maxSlippageBps) / 10000;
            if (minOut == 0) minOut = 1;

            IERC20(usdst).approve(poolAddress, mintAmt);
            uint received = pool.swap(swapIsAToB, mintAmt, minOut, deadline);
            available = received;
        }

        // Deposit any remaining collateral from the final swap
        if (available >= DUST) {
            IERC20(asset).approve(vaultAddr, available);
            engine.depositFor(address(this), msg.sender, asset, available);
        }

        require(remainingDebt == 0, "target not reached");

        // Sweep only residual from this call (delta over pre-call snapshot).
        // Stray balances from unrelated transfers are not misattributed.
        uint assetBalAfter = IERC20(asset).balanceOf(address(this));
        if (assetBalAfter > assetBalBefore) {
            require(IERC20(asset).transfer(msg.sender, assetBalAfter - assetBalBefore), "asset sweep failed");
        }
        uint usdstBalAfter = IERC20(usdst).balanceOf(address(this));
        if (usdstBalAfter > usdstBalBefore) {
            require(IERC20(usdst).transfer(msg.sender, usdstBalAfter - usdstBalBefore), "usdst sweep failed");
        }

        // Final state from engine
        rateAcc = _freshRate(engine, asset);
        (uint finalColl, uint finalScaledDebt) = engine.vaults(msg.sender, asset);
        totalCollateral = finalColl;
        totalDebt = finalScaledDebt * rateAcc / 1e27;

        emit LeveragedUp(msg.sender, asset, amount, totalCollateral, totalDebt, loopsCompleted);
        return (totalCollateral, totalDebt);
    }

    function rescueTokens(address token, address to, uint amount) external onlyOwner {
        require(to != address(0), "invalid to");
        require(token != address(registry.usdst()), "cannot rescue USDST");
        require(!registry.cdpEngine().isSupportedAsset(token), "cannot rescue collateral asset");
        require(IERC20(token).transfer(to, amount), "transfer failed");
    }
}
