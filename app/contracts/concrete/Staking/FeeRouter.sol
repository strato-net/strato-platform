abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
}

interface IStakingGovernanceLookup {
    function stakingContract() external view returns (address);
}

interface IStakingFeeHook {
    function proposerFeeBps() external view returns (uint);
    function processBlock() external;
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

    function payFees() external {
        uint voucherFee = 1e18;
        uint usdstFee = 1e16; // $0.01
        uint bpsDivisor = 10000;
        address voucher = _voucher();
        address USDST = _usdst();
        address feeCollector = _feeCollector();
        address governance = _governance();

        bool paidWithVoucher = true;
        try { // try to use a voucher
            voucher.call("burn", address(this), voucherFee);
        } catch {
            paidWithVoucher = false;
        }

        address staking = address(0);
        try IStakingGovernanceLookup(governance).stakingContract() returns (address s) {
            staking = s;
        } catch {
        }

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
