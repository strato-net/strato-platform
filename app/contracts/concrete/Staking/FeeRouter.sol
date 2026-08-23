abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
}

interface IStakingGovernanceLookup {
    function stakingContract() external view returns (address);
}

interface IStakingFeeHook {
    function proposerFeeBps() external view returns (uint);
    function processBlock() external;
    function stratoToken() external view returns (address);
}

// Transaction fee implementation for Decider (0xDEC1DE), installed with
// DeciderState.updatePayFeeContract. The platform DELEGATECALLs payFees for every
// transaction in the signer's storage context, so this contract keeps no storage:
// address(this) is the signer and every address is a genesis constant.
//
// Fee policy: one voucher, else $0.01 USDST split between the FeeCollector and the
// staking contract (credited to block.proposer's operator and delegators). Every
// transaction also gives the staking contract a chance to process the previous
// block (missed-proposal slashing); that call must never fail the transaction.
contract record FeeRouter {
    // Genesis addresses, as functions so a test harness can point them elsewhere.
    function _voucher() internal view virtual returns (address) { return address(0x000000000000000000000000000000000000100e); }
    function _usdst() internal view virtual returns (address) { return address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010); }
    function _feeCollector() internal view virtual returns (address) { return address(0x100d); }
    function _governance() internal view virtual returns (address) { return address(0x100); } // MercataGovernance

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

    // Flat reward per block, paid to the proposer out of this contract's own
    // STRATO balance. Fund the router to switch it on: an unfunded router pays
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
        // router that has run dry has to be survivable.
        bool paid = false;
        try {
            ERC20_Template(strato).transfer(proposer, BLOCK_REWARD);
            paid = true;
        } catch {
        }
        if (paid) emit BlockRewardsPaid(block.number, proposer, BLOCK_REWARD);
    }

    function payFees() external {
        uint voucherFee = 1e18;
        uint usdstFee = 1e16; // $0.01
        uint bpsDivisor = 10000;
        address voucher = _voucher();
        address USDST = _usdst();
        address feeCollector = _feeCollector();

        bool paidWithVoucher = true;
        try { // try to use a voucher
            voucher.call("burn", address(this), voucherFee);
        } catch {
            paidWithVoucher = false;
        }

        address staking = _staking();

        if (!paidWithVoucher) { // no voucher, pay in USDST
            uint proposerShare = 0;
            if (staking != address(0)) {
                try IStakingFeeHook(staking).proposerFeeBps() returns (uint bps) {
                    if (bps > bpsDivisor) bps = bpsDivisor;
                    proposerShare = (usdstFee * bps) / bpsDivisor;
                } catch {
                }
            }
            if (proposerShare < usdstFee) {
                ERC20_Template(USDST).transfer(feeCollector, usdstFee - proposerShare);
            }
            if (proposerShare > 0) {
                try {
                    ERC20_Template(USDST).transfer(staking, proposerShare);
                } catch {
                    ERC20_Template(USDST).transfer(feeCollector, proposerShare);
                }
            }
        }

        if (staking != address(0)) {
            try IStakingFeeHook(staking).processBlock() {
            } catch {
            }
        }
    }
}
