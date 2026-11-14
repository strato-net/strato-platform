abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
  function transferFrom(address _from, address _to, uint _amount) public;
  function approve(address _spender, uint _amount) public;
  function allowance(address _owner, address _spender) public view returns (uint);
}

interface IGasToken {
    function balanceOf(address account) external view returns (uint);
    function decimals() external view returns (uint8);
}

interface IFeeContractLookup {
    function getImplContract() external view returns (address);
}

interface IStratoFeeQuote {
    function stratoFeeQuote() external view returns (uint fee, uint priceVersion, bool valid);
}

interface IFeeSink {
    function sinkFee(uint amount) external;
    function buyAndSinkFee(uint shortfall) external;
}

interface ICanonicalPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function liquidity() external view returns (uint);
    function observe(uint[] secondsAgos) external view returns (int[] tickCumulatives, int[] secondsPerLiquidityCumulativeX128s);
    function getSqrtRatioAtTick(int tick) external pure returns (uint);
    function quoteGasExactOutput(bool zeroForOne, uint output) external view returns (uint input, uint rounding, bool complete);
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

enum FeeMethod { NONE, VOUCHER, STRATO_BURN, USDST_SWAP_BURN, USDST_COLLECTED }

// Transaction fee implementation for Decider (0xDEC1DE), installed with
// DeciderState.updatePayFeeContract. The platform DELEGATECALLs payFees for every
// transaction in the signer's storage context, so nothing payFees touches may be this
// contract's storage: there, address(this) is the signer and every address is a
// constant, a genesis address or one the per-network deployable subclass names.
//
// Fee policy, $0.01 per submitted transaction, paid with the first of:
//   1. one whole voucher;
//   2. STRATO worth 0.01 USDST, transferred from the signer to FEE_ADDRESS, so
//      totalSupply stays fixed. Nothing is split.
//      A signer short of STRATO buys exactly the shortfall through the router with
//      its own USDST. The pool sends that STRATO directly to the fee address. The
//      purchase is capped at its time-weighted value plus a bounded premium.
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
    function _feeCollector() internal view virtual returns (address) { return address(0x000000000000000000000000000000000000100d); }

    // Block from which fees are paid in STRATO and block rewards are paid. Before it the
    // router charges exactly what DeciderState's own payFees charges (one whole
    // voucher, else 0.01 USDST to FeeCollector), quotes nothing and pays nothing, so
    // it can be installed ahead of the platform's native-token flag day and the two
    // switch at one block: set it to that network's stratoGasForkBlock. 0 is active
    // from genesis.
    function _activationBlock() internal view virtual returns (uint) { return 0; }
    function _active() internal view returns (bool) { return block.number >= _activationBlock(); }
    function activationBlock() external view returns (uint) { return _activationBlock(); }

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
    address constant FEE_ADDRESS = address(0xdead5712a70000000000000000000dead5712a70);
    uint constant Q192 = 6277101735386680763835789423207666416102355444464034512896; // 2**192: sqrtPriceX96 squared is Q192

    function _burnAddress() internal view virtual returns (address) { return FEE_ADDRESS; }
    function burnAddress() external view returns (address) { return _burnAddress(); }

    // ---- Router storage. Accessed only by plain calls, including gas settlement:
    // address(this) is the router and this really is its own state. ----

    // Block-number latch for payBlockRewards.
    uint256 public lastRewardedBlock;

    // The STRATO fee from the last pricing that succeeded, when it was priced, and a
    // counter that moves with every new price so receipts can name the rate they paid at.
    uint256 public quotedFee;
    uint256 public quotedAt;
    uint256 public quotedBlock;
    uint256 public priceVersion;

    bool internal gasSettlementEntered;

    modifier gasSettlementLock() {
        require(!gasSettlementEntered, "FeeRouter: gas settlement reentry");
        gasSettlementEntered = true;
        _;
        gasSettlementEntered = false;
    }

    // Flat reward per block for the proposer, paid out of this contract's own
    // STRATO balance into staking, which splits it between the proposer's operator
    // and its delegators. Fund the router to switch it on: an unfunded router pays
    // nothing rather than stalling the chain. Fees go to FEE_ADDRESS, which leaves this
    // as the validators' funding. Zero switches rewards off for good.
    function _blockReward() internal view virtual returns (uint) { return 1e16; } // 0.01 STRATO
    function blockReward() external view returns (uint) { return _blockReward(); }

    event StratoFeeQuoted(uint256 indexed blockNumber, uint256 fee, uint256 priceVersion);
    event FeePaid(address indexed payer, FeeMethod method, uint256 amount, uint256 priceVersion);
    // Enum-free native receipt for native event indexers and compatible RPCs.
    event GasFeeReceipt(address indexed payer, address indexed router, uint256 method, uint256 amount, uint256 priceVersion);
    event GasCanary(address indexed payer, address indexed router, address indexed feeRouter, uint256 fee, uint256 version, uint256 quoteBlock, uint256 usdAllowance, uint256 poolAllowance, uint256 routerUsd, uint256 payerUsd, uint256 payerStrato, uint256 payerVoucher);

    // A controlled transaction's execution-phase witness, after its native fee.
    // No historical eth_call or user-supplied event provenance is needed.
    function gasCanary() external {
        emit GasCanary(msg.sender, address(this), IFeeContractLookup(_deciderState()).getImplContract(), quotedFee, priceVersion, quotedBlock,
            ERC20_Template(_usdst()).allowance(msg.sender, address(this)), ERC20_Template(_usdst()).allowance(address(this), _pool()),
            IGasToken(_usdst()).balanceOf(address(this)), IGasToken(_usdst()).balanceOf(msg.sender), IGasToken(_strato()).balanceOf(msg.sender), IGasToken(_voucher()).balanceOf(msg.sender));
    }
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
        if (!_active()) return;

        _quoteStratoFee();
        _payBlockReward();
    }

    // What the pool would price a call at right now, so a router can be checked
    // before its activation block without writing a quote.
    function previewStratoFee() external view returns (uint) {
        return _priceStratoFee();
    }

    // Pricing that cannot be trusted (no history, liquidity gone, pair changed) leaves
    // the previous quote in place, frozen until the pool prices again.
    function _quoteStratoFee() internal {
        uint fee = _priceStratoFee();
        if (fee == 0) return;
        quotedFee = fee;
        quotedAt = block.timestamp;
        quotedBlock = block.number;
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

    // What a transaction in the current block pays in STRATO. STRATO always pays once
    // a first price exists; only before it must a voucher pay.
    function stratoFeeQuote() external view returns (uint fee, uint version, bool valid) {
        return (quotedFee, priceVersion, quotedFee > 0);
    }

    function _payBlockReward() internal {
        uint reward = _blockReward();
        if (reward == 0) return;
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
            ERC20_Template(strato).approve(staking, reward);
            approved = true;
        } catch {
        }
        if (!approved) return;

        bool paid = false;
        try IStakingFeeHook(staking).creditBlockReward(proposer, reward) {
            paid = true;
        } catch {
        }
        if (paid) emit BlockRewardsPaid(block.number, proposer, reward);
    }

    function payFees() external {
        // The native DELEGATECALL has both sender and storage context equal to
        // the signer. A normal public CALL must not spend this router's reserves.
        require(msg.sender == address(this), "FeeRouter: signer context only");
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

        if (!paidWithVoucher && !_active()) {
            // The legacy fee, as DeciderState's own payFees charges it: signers see
            // no change until the activation block.
            ERC20_Template(_usdst()).transfer(_feeCollector(), USD_FEE);
            method = FeeMethod.USDST_COLLECTED;
            amount = USD_FEE;
        } else if (!paidWithVoucher) {
            // The quote lives in the installed router's own storage, which this
            // DELEGATECALL cannot see; DeciderState names the router, so ask it.
            address router = IFeeContractLookup(_deciderState()).getImplContract();
            (uint fee, uint ver, bool valid) = IStratoFeeQuote(router).stratoFeeQuote();
            require(valid, "FeeRouter: no STRATO price, a voucher is required");
            address strato = _strato();
            uint held = IGasToken(strato).balanceOf(address(this));
            uint fromHeld = held < fee ? held : fee;
            method = FeeMethod.STRATO_BURN;
            if (held < fee) {
                _buyStratoShortfall(router, fee - held, fee);
                method = FeeMethod.USDST_SWAP_BURN;
            }
            // A paused STRATO lets only whitelisted callers move it, and this runs as
            // the signer, so the signer approves the installed router (whitelisted for
            // transferFrom) and the router sinks the portion already held. Failure
            // rolls back the purchase too: an unpaid transaction moves nothing.
            if (fromHeld > 0) {
                ERC20_Template(strato).approve(router, fromHeld);
                IFeeSink(router).sinkFee(fromHeld);
            }
            amount = fee;
            version = ver;
        }
        emit FeePaid(address(this), method, amount, version);
        emit GasFeeReceipt(address(this), IFeeContractLookup(_deciderState()).getImplContract(), uint(method), amount, version);

        if (staking != address(0)) {
            try IStakingFeeHook(staking).processBlock() {
            } catch {
            }
        }
    }

    // The STRATO leg of payFees, as a plain call so the token sees the router as the
    // caller. It only ever moves the caller's own STRATO, out of the allowance the
    // caller just gave, and only to FEE_ADDRESS.
    function sinkFee(uint amount) external {
        ERC20_Template(_strato()).transferFrom(msg.sender, _burnAddress(), amount);
    }

    function _maxShortfallInput(uint shortfall, uint fee) internal view returns (uint) {
        uint proportional = (shortfall * USD_FEE * (10000 + _maxSwapPremiumBps()) + fee * 10000 - 1) / (fee * 10000);
        ICanonicalPool pool = ICanonicalPool(_pool());
        (uint input, uint rounding, bool complete) = pool.quoteGasExactOutput(address(pool.token0()) == _usdst(), shortfall);
        require(complete && input > 0, "FeeRouter: incomplete gas quote");
        uint fullFeeCap = (USD_FEE * (10000 + _maxSwapPremiumBps()) + 9999) / 10000;
        uint roundedCap = proportional + rounding;
        return roundedCap < fullFeeCap ? roundedCap : fullFeeCap;
    }

    // This still runs as the payer. A normal call makes the pool see the installed
    // router, so its caller restriction does not need to trust the payer's identity.
    function _buyStratoShortfall(address router, uint shortfall, uint fee) internal {
        address usdst = _usdst();
        uint allowance = ERC20_Template(usdst).allowance(address(this), router);
        ERC20_Template(usdst).approve(router, _maxShortfallInput(shortfall, fee));
        IFeeSink(router).buyAndSinkFee(shortfall);
        ERC20_Template(usdst).approve(router, allowance);
    }

    // Only the caller funds this bounded purchase, and its only STRATO recipient
    // is the burn address. Calling this directly cannot buy spendable STRATO or
    // spend another payer's approval. Router balances and unused input stay intact.
    function buyAndSinkFee(uint shortfall) external gasSettlementLock {
        require(address(this) == IFeeContractLookup(_deciderState()).getImplContract(), "FeeRouter: installed router only");
        require(_active() && quotedFee > 0, "FeeRouter: no active STRATO quote");
        require(shortfall > 0 && shortfall <= quotedFee, "FeeRouter: invalid gas shortfall");

        address pool = _pool();
        address usdst = _usdst();
        uint maxIn = _maxShortfallInput(shortfall, quotedFee);
        uint available = IGasToken(usdst).balanceOf(msg.sender);
        uint funded = available < maxIn ? available : maxIn;
        require(funded > 0, "FeeRouter: no USDST for gas");

        ERC20_Template(usdst).transferFrom(msg.sender, address(this), funded);
        ERC20_Template(usdst).approve(pool, funded);
        bool usdstIsToken0 = address(ICanonicalPool(pool).token0()) == usdst;
        (int amount0, int amount1) = ICanonicalPool(pool).swap(_burnAddress(), usdstIsToken0, -int(shortfall), 0, funded, block.timestamp);
        require((usdstIsToken0 ? amount1 : amount0) == -int(shortfall), "FeeRouter: incomplete gas purchase");
        int input = usdstIsToken0 ? amount0 : amount1;
        require(input > 0 && uint(input) <= funded, "FeeRouter: invalid gas input");
        ERC20_Template(usdst).approve(pool, 0);

        uint refund = funded - uint(input);
        if (refund > 0) ERC20_Template(usdst).transfer(msg.sender, refund);
    }
}
