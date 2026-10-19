abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
  function approve(address _spender, uint _amount) public;
  function allowance(address _owner, address _spender) public view returns (uint);
}

interface IGasToken {
    function burn(uint amount) external; // holder-only Token.burn(uint256)
    function balanceOf(address account) external view returns (uint);
    function decimals() external view returns (uint8);
}

interface IFeeContractLookup {
    function getImplContract() external view returns (address);
}

interface IStratoFeeQuote {
    function stratoFeeQuote() external view returns (uint fee, uint priceVersion, bool valid);
}

interface ICanonicalPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function liquidity() external view returns (uint);
    function observe(uint[] secondsAgos) external view returns (int[] tickCumulatives, int[] secondsPerLiquidityCumulativeX128s);
    function getSqrtRatioAtTick(int tick) external pure returns (uint);
    function swap(address recipient, bool zeroForOne, int amountSpecified, uint sqrtPriceLimitX96, uint amountLimit, uint deadline) external returns (int amount0, int amount1);
}

interface IStakingGovernanceLookup {
    function stakingContract() external view returns (address);
}

interface IStakingFeeHook {
    function processBlock() external;
    function stratoToken() external view returns (address);
    function creditBlockReward(address validator, uint256 amount) external;
}

enum FeeMethod { NONE, VOUCHER, STRATO_BURN, USDST_SWAP_BURN }

// Transaction fee implementation for Decider (0xDEC1DE), installed with
// DeciderState.updatePayFeeContract. The platform DELEGATECALLs payFees for every
// transaction in the signer's storage context, so nothing payFees touches may be this
// contract's storage: there, address(this) is the signer and every address is a
// constant, a genesis address or one the per-network deployable subclass names.
//
// Fee policy, $0.01 per submitted transaction, paid with the first of:
//   1. one whole voucher;
//   2. STRATO worth 0.01 USDST, burned from the signer. Nothing is collected or split.
//      A signer short of STRATO first buys exactly the shortfall from the canonical pool
//      with its own USDST, paying at most the shortfall's time-weighted value plus a
//      bounded premium, so a USDST-only account keeps transacting through the switch.
// A signer with none of these has not paid, and the platform rejects the transaction
// before it runs. Included transactions that revert have still paid.
//
// The STRATO amount is priced once per block, before any of the block's transactions,
// from the canonical STRATO/USDST PoolV3's time-weighted average price over committed
// parent state, so every transaction in a block pays the same amount. That quote is
// written by payBlockRewards, a plain call whose storage really is the router's, and
// payFees reads it back through a plain call to the installed router (DeciderState
// names it), never through its own storage reads.
//
// Every transaction also gives the staking contract a chance to process the previous
// block (missed-proposal slashing); that call must never fail the transaction.
contract record FeeRouter {
    // Genesis addresses, as functions so a test harness can point them elsewhere.
    function _voucher() internal view virtual returns (address) { return address(0x000000000000000000000000000000000000100e); }
    function _usdst() internal view virtual returns (address) { return address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010); }
    function _governance() internal view virtual returns (address) { return address(0x100); } // MercataGovernance
    function _deciderState() internal view virtual returns (address) { return address(0xDEC1DE02); }

    // STRATO was deployed after genesis and its address differs per network, so the
    // deployable subclass names it (gen-feerouter-source.js). Zero leaves STRATO out of
    // the fee path, which makes every transaction voucher-only.
    function _strato() internal view virtual returns (address) { return address(0); }

    // The canonical STRATO/USDST PoolV3 the fee is priced from, also named by the
    // subclass. Replacing it means a new router, and the new pool prices nothing until
    // its observation ring covers the window, so the swap is voucher-only until then.
    function _pool() internal view virtual returns (address) { return address(0); }

    // Averaging window for the pool price. observe() reverts until the pool has that
    // much history, so a fresh pool is inert rather than priced off a single tick.
    function _twapWindow() internal view virtual returns (uint) { return 1800; }

    // How long the last good quote stays chargeable once the pool stops pricing (no
    // history, liquidity gone, pair changed). Past it, fees are voucher-only until
    // pricing recovers.
    function _priceGrace() internal view virtual returns (uint) { return 3600; }

    // In-range liquidity below which the pool is not trusted to price. A time average
    // alone does not make a thin pool reliable; set from depth and manipulation cost.
    function _minPoolLiquidity() internal view virtual returns (uint) { return 0; }

    // How far the USDST spent buying a STRATO shortfall may exceed the shortfall's
    // time-weighted value (pool fee, slippage, spot drift since the block's quote)
    // before the fallback refuses and the transaction is rejected. At 100% a $0.01
    // fee can never cost more than $0.02 in USDST.
    function _maxSwapPremiumBps() internal view virtual returns (uint) { return 10000; }

    // Chains whose genesis governance predates staking have no stakingContract() to
    // ask, so they subclass this with the deployed address. It cannot be storage:
    // payFees is DELEGATECALLed and SolidVM storage is name-keyed, so any state read
    // here would resolve against the signer, not the router.
    function _stakingFallback() internal view virtual returns (address) { return address(0); }

    function _staking() internal view virtual returns (address) {
        address staking = address(0);
        try IStakingGovernanceLookup(_governance()).stakingContract() returns (address s) {
            staking = s;
        } catch {
        }
        if (staking == address(0)) staking = _stakingFallback();
        return staking;
    }

    uint constant USD_FEE = 1e16; // $0.01, in 18-decimal USDST
    uint constant VOUCHER_FEE = 1e18; // one whole voucher
    uint constant Q192 = 6277101735386680763835789423207666416102355444464034512896; // 2**192: sqrtPriceX96 squared is Q192

    // ---- Router storage. Only payBlockRewards and the views may touch it: those are
    // plain calls, so address(this) is the router and this really is its own state. ----

    // Block-number latch for payBlockRewards.
    uint256 public lastRewardedBlock;

    // The STRATO fee from the last pricing that succeeded, when it was priced, and a
    // counter that moves with every new price so receipts can name the rate they paid at.
    uint256 public quotedFee;
    uint256 public quotedAt;
    uint256 public priceVersion;

    // Flat reward per block for the proposer, paid out of this contract's own
    // STRATO balance into staking, which splits it between the proposer's operator
    // and its delegators. Fund the router to switch it on: an unfunded router pays
    // nothing rather than stalling the chain. Burning the fee leaves this as the
    // validators' funding.
    uint256 constant BLOCK_REWARD = 1e16; // 0.01 STRATO

    event StratoFeeQuoted(uint256 indexed blockNumber, uint256 fee, uint256 priceVersion);
    event FeePaid(address indexed payer, FeeMethod method, uint256 amount, uint256 priceVersion);
    event BlockRewardsPaid(uint256 indexed blockNumber, address indexed proposer, uint256 amount);

    // Block hook: the platform calls this once per block, before any of the block's
    // transactions, on whatever DeciderState currently points at. It freezes the
    // block's STRATO fee and then pays the block reward.
    //
    // The platform decides once-per-block on its own (Bagger clears a flag when
    // the height advances), so this latch is a second line of defence rather than
    // the thing that makes rewards single. It costs nothing and it cannot misfire:
    // it lives in contract state, so any replay from the parent state root sees it
    // reset. Latching first also stops a reentrant call from paying twice.
    function payBlockRewards() external {
        if (lastRewardedBlock == block.number) return;
        lastRewardedBlock = block.number;

        _quoteStratoFee();
        _payBlockReward();
    }

    // Pricing that cannot be trusted leaves the previous quote in place; stratoFeeQuote
    // decides, by age, whether that quote is still chargeable.
    function _quoteStratoFee() internal {
        uint fee = _priceStratoFee();
        if (fee == 0) return;
        quotedFee = fee;
        quotedAt = block.timestamp;
        priceVersion += 1;
        emit StratoFeeQuoted(block.number, fee, priceVersion);
    }

    // STRATO worth USD_FEE at the pool's time-weighted average price, rounded up so the
    // division never short-changes the fee; 0 when the pool cannot price. Must never
    // revert: it runs inside block execution on every node.
    function _priceStratoFee() internal view returns (uint) {
        address pool = _pool();
        address strato = _strato();
        if (pool == address(0) || strato == address(0)) return 0;

        uint fee = 0;
        try {
            // The pool's token fields are contract-typed; the cast makes them comparable.
            address token0 = address(ICanonicalPool(pool).token0());
            address token1 = address(ICanonicalPool(pool).token1());
            bool stratoIsToken0 = token0 == strato && token1 == _usdst();
            bool stratoIsToken1 = token1 == strato && token0 == _usdst();
            // 18 decimals on both sides, so the raw pool ratio is USDST per STRATO.
            bool priced = (stratoIsToken0 || stratoIsToken1)
                && IGasToken(token0).decimals() == 18
                && IGasToken(token1).decimals() == 18
                && ICanonicalPool(pool).liquidity() >= _minPoolLiquidity();
            if (priced) {
                uint window = _twapWindow();
                // Reverts "OLD" until the observation ring reaches back a full window.
                (int[] cums, ) = ICanonicalPool(pool).observe([window, uint(0)]);
                // SolidVM's int division floors, which is how the canonical oracle rounds
                // a time-weighted tick.
                int avgTick = (cums[1] - cums[0]) / int(window);
                uint sqrtP = ICanonicalPool(pool).getSqrtRatioAtTick(avgTick);
                uint ratio = sqrtP * sqrtP; // token1 per token0, Q192
                if (stratoIsToken0) {
                    fee = (USD_FEE * Q192 + ratio - 1) / ratio;
                } else {
                    fee = (USD_FEE * ratio + Q192 - 1) / Q192;
                }
            }
        } catch {
            fee = 0;
        }
        return fee;
    }

    // What a transaction in the current block pays in STRATO. Invalid once the last
    // good price is older than the grace period; then only a voucher pays.
    function stratoFeeQuote() external view returns (uint fee, uint version, bool valid) {
        bool usable = quotedFee > 0 && block.timestamp <= quotedAt + _priceGrace();
        return (quotedFee, priceVersion, usable);
    }

    function _payBlockReward() internal {
        address proposer = block.proposer;
        if (proposer == address(0)) return;

        // Pay in whatever token staking accounts in, so this needs no second
        // hardcoded address and stays correct on every chain.
        address staking = _staking();
        if (staking == address(0)) return;
        address strato = address(0);
        try IStakingFeeHook(staking).stratoToken() returns (address t) {
            strato = t;
        } catch {
        }
        if (strato == address(0)) return;

        // Must never revert: this runs inside block execution on every node, so a
        // router that has run dry, or a proposer staking will not credit (not listed,
        // delisted), has to be survivable. Staking pulls the approved amount, so it
        // can only credit what the router actually pays; if it declines, the reward
        // simply stays here.
        bool approved = false;
        try {
            ERC20_Template(strato).approve(staking, BLOCK_REWARD);
            approved = true;
        } catch {
        }
        if (!approved) return;

        bool paid = false;
        try IStakingFeeHook(staking).creditBlockReward(proposer, BLOCK_REWARD) {
            paid = true;
        } catch {
        }
        if (paid) emit BlockRewardsPaid(block.number, proposer, BLOCK_REWARD);
    }

    function payFees() external {
        address staking = _staking();

        FeeMethod method = FeeMethod.VOUCHER;
        uint amount = VOUCHER_FEE;
        uint version = 0;

        // The voucher burns from msg.sender, which here is the signer, and reverts
        // on less than a whole voucher.
        bool paidWithVoucher = false;
        try {
            _voucher().call("burn", address(this), VOUCHER_FEE);
            paidWithVoucher = true;
        } catch {
        }

        if (!paidWithVoucher) {
            // The quote lives in the installed router's own storage, which this
            // DELEGATECALL cannot see; DeciderState names the router, so ask it.
            address router = IFeeContractLookup(_deciderState()).getImplContract();
            (uint fee, uint ver, bool valid) = IStratoFeeQuote(router).stratoFeeQuote();
            require(valid, "FeeRouter: no STRATO price, a voucher is required");
            address strato = _strato();
            uint held = IGasToken(strato).balanceOf(address(this));
            method = FeeMethod.STRATO_BURN;
            if (held < fee) {
                _buyStratoShortfall(fee - held, fee);
                method = FeeMethod.USDST_SWAP_BURN;
            }
            // A signer still short reverts here, and the platform rejects the
            // transaction before it runs: nothing is burned or swapped for a
            // transaction that is not included.
            IGasToken(strato).burn(fee);
            amount = fee;
            version = ver;
        }
        emit FeePaid(address(this), method, amount, version);

        if (staking != address(0)) {
            try IStakingFeeHook(staking).processBlock() {
            } catch {
            }
        }
    }

    // Buy exactly `shortfall` STRATO from the canonical pool with the signer's USDST.
    // Still the signer's context: the approval and the swap are the signer's own, and
    // any allowance the signer already gave the pool is put back afterwards. `fee`
    // STRATO is worth USD_FEE at the block's quote, which prices the shortfall; the
    // pool may charge up to that plus the premium, else it reverts and nothing moves.
    function _buyStratoShortfall(uint shortfall, uint fee) internal {
        address pool = _pool();
        address usdst = _usdst();
        uint maxIn = (shortfall * USD_FEE * (10000 + _maxSwapPremiumBps()) + fee * 10000 - 1) / (fee * 10000);
        bool usdstIsToken0 = address(ICanonicalPool(pool).token0()) == usdst;

        uint allowance = ERC20_Template(usdst).allowance(address(this), pool);
        ERC20_Template(usdst).approve(pool, allowance + maxIn);
        ICanonicalPool(pool).swap(address(this), usdstIsToken0, -int(shortfall), 0, maxIn, block.timestamp);
        ERC20_Template(usdst).approve(pool, allowance);
    }
}
