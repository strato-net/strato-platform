abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
  function approve(address _spender, uint _amount) public;
  function balanceOf(address _owner) public view returns (uint);
}

interface IPausableFeeToken {
    function paused() external view returns (bool);
}

interface IFeePriceOracle {
    function getAssetPriceWithTimestamp(address asset) external view returns (uint256 price, uint256 timestamp);
}

interface IStakingGovernanceLookup {
    function stakingContract() external view returns (address);
}

interface IStakingFeeHook {
    function proposerFeeBps() external view returns (uint);
    function processBlock() external;
    function stratoToken() external view returns (address);
    function creditBlockReward(address validator, uint256 amount) external;
}

// Transaction fee implementation for Decider (0xDEC1DE), installed with
// DeciderState.updatePayFeeContract. The platform DELEGATECALLs payFees for every
// transaction in the signer's storage context, so this contract keeps no storage:
// address(this) is the signer and every address is a constant: a genesis address, or
// one the per-network deployable subclass names.
//
// Fee policy, $0.01 paid with the first of these the signer can cover:
//   1. STRATO at the PriceOracle price, to the FeeCollector;
//   2. USDST, split between the FeeCollector and the staking contract (credited to
//      block.proposer's operator and delegators);
//   3. one voucher.
// Every transaction also gives the staking contract a chance to process the previous
// block (missed-proposal slashing); that call must never fail the transaction.
contract record FeeRouter {
    // Genesis addresses, as functions so a test harness can point them elsewhere.
    function _voucher() internal view virtual returns (address) { return address(0x000000000000000000000000000000000000100e); }
    function _usdst() internal view virtual returns (address) { return address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010); }
    function _feeCollector() internal view virtual returns (address) { return address(0x100d); }
    function _governance() internal view virtual returns (address) { return address(0x100); } // MercataGovernance
    function _priceOracle() internal view virtual returns (address) { return address(0x1002); }

    // STRATO was deployed after genesis and its address differs per network, so the
    // deployable subclass names it (gen-feerouter-source.js). Zero leaves STRATO out of
    // the fee path.
    function _strato() internal view virtual returns (address) { return address(0); }

    // Oldest oracle price a STRATO fee may be charged at. The oracle service pushes
    // every 15 minutes, so this rides out a few missed rounds; past it, fees fall back
    // to USDST rather than charge at a price that may have moved.
    function _maxPriceAge() internal view virtual returns (uint) { return 3600; }

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

    // Block-number latch for payBlockRewards. Unlike payFees this is a plain call,
    // so address(this) is the router and this really is the router's own storage.
    uint256 public lastRewardedBlock;

    // Flat reward per block for the proposer, paid out of this contract's own
    // STRATO balance into staking, which splits it between the proposer's operator
    // and its delegators. Fund the router to switch it on: an unfunded router pays
    // nothing rather than stalling the chain.
    uint256 constant BLOCK_REWARD = 1e16; // 0.01 STRATO

    event BlockRewardsPaid(uint256 indexed blockNumber, address indexed proposer, uint256 amount);

    // Block reward hook: the platform calls this once per block, before any of the
    // block's transactions, on whatever DeciderState currently points at.
    //
    // The platform decides once-per-block on its own (Bagger clears a flag when
    // the height advances), so this latch is a second line of defence rather than
    // the thing that makes rewards single. It costs nothing and it cannot misfire:
    // it lives in contract state, so any replay from the parent state root sees it
    // reset. Latching first also stops a reentrant call from paying twice.
    function payBlockRewards() external {
        if (lastRewardedBlock == block.number) return;
        lastRewardedBlock = block.number;

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
        uint usdFee = 1e16; // $0.01, 18-decimal like the oracle's prices
        address staking = _staking();

        bool paid = _payWithStrato(usdFee);
        if (!paid) {
            paid = _payWithUsdst(usdFee, staking);
        }
        if (!paid) {
            // The last option is the only one allowed to throw: a signer without a
            // voucher either has not paid, and the platform rejects the transaction.
            address voucher = _voucher();
            voucher.call("burn", address(this), 1e18);
        }

        if (staking != address(0)) {
            try IStakingFeeHook(staking).processBlock() {
            } catch {
            }
        }
    }

    // Each option either takes the whole fee or declines having moved nothing, so the
    // caller can move on to the next one without charging twice.

    function _payWithStrato(uint usdFee) internal returns (bool) {
        address strato = _strato();
        if (strato == address(0)) return false;

        // A paused STRATO refuses the signer's transfer anyway; asking first is cheaper
        // than failing through the token's whitelist lookup on every transaction.
        bool transferable = false;
        try IPausableFeeToken(strato).paused() returns (bool isPaused) {
            transferable = !isPaused;
        } catch {
        }
        if (!transferable) return false;

        // Block-form try on purpose: SolidVM's `try f() returns (a, b)` raises an
        // uncatchable type error for any multi-value return, which here would reject
        // every transaction that reaches this point.
        uint price = 0;
        uint updatedAt = 0;
        try {
            (uint p, uint t) = IFeePriceOracle(_priceOracle()).getAssetPriceWithTimestamp(strato);
            price = p;
            updatedAt = t;
        } catch {
        }
        if (price == 0) return false;
        if (updatedAt > block.timestamp) return false;
        if (block.timestamp - updatedAt > _maxPriceAge()) return false;

        // Rounded up, so the protocol is never short-changed by the division.
        uint fee = (usdFee * 1e18 + price - 1) / price;
        return _tryTransfer(strato, _feeCollector(), fee);
    }

    // The proposer's share (staking's proposerFeeBps) goes to staking, the rest to the
    // FeeCollector. A SolidVM catch does not roll back, so the whole fee is checked
    // against the balance before anything moves: once one transfer has landed, the
    // other cannot fail for want of funds.
    function _payWithUsdst(uint fee, address staking) internal returns (bool) {
        address USDST = _usdst();
        address feeCollector = _feeCollector();

        uint balance = 0;
        try ERC20_Template(USDST).balanceOf(address(this)) returns (uint b) {
            balance = b;
        } catch {
        }
        if (balance < fee) return false;

        uint proposerShare = 0;
        if (staking != address(0)) {
            uint bpsDivisor = 10000;
            try IStakingFeeHook(staking).proposerFeeBps() returns (uint bps) {
                if (bps > bpsDivisor) bps = bpsDivisor;
                proposerShare = (fee * bps) / bpsDivisor;
            } catch {
            }
        }

        // Staking's share first; if staking will not take it, it goes to the collector.
        uint toCollector = fee;
        if (proposerShare > 0) {
            if (_tryTransfer(USDST, staking, proposerShare)) {
                toCollector = fee - proposerShare;
            }
        }
        if (toCollector == fee) {
            return _tryTransfer(USDST, feeCollector, fee);
        }
        if (toCollector > 0) {
            // Staking's share has landed and the balance covers the rest, so this can
            // only fail on a token fault; if it does, reject the transaction rather than
            // go on to charge a voucher as well.
            ERC20_Template(USDST).transfer(feeCollector, toCollector);
        }
        return true;
    }

    function _tryTransfer(address token, address to, uint amount) internal returns (bool) {
        bool ok = false;
        try {
            ERC20_Template(token).transfer(to, amount);
            ok = true;
        } catch {
        }
        return ok;
    }
}
