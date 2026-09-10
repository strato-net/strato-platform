import <dec1de02>;

contract record PayFeesWithVoucher {
    // Block-number latch for payBlockRewards. payFees is DELEGATECALLed into the
    // signer's storage, but payBlockRewards is a plain call, so this is this
    // contract's own state.
    uint256 public lastRewardedBlock;

    // Flat reward per block, paid to the proposer out of this contract's own
    // STRATO balance. Fund the contract to switch it on: unfunded, it pays
    // nothing rather than stalling the chain.
    uint256 constant BLOCK_REWARD = 1e16; // 0.01 STRATO

    event BlockRewardsPaid(uint256 indexed blockNumber, address indexed proposer, uint256 amount);

    // Block reward hook: the platform calls this once per block, before any of the
    // block's transactions. The platform already guarantees once-per-block; the
    // latch is a second line of defence and a reentrancy guard.
    function payBlockRewards() external {
        if (lastRewardedBlock == block.number) return;
        lastRewardedBlock = block.number;

        address proposer = block.proposer;
        if (proposer == address(0)) return;

        // Must never revert: this runs inside block execution on every node.
        bool paid = false;
        try {
            ERC20_Template(address(0x8ee9a3391e38176feebf5d43cb2c1d6c4f728b04)).transfer(proposer, BLOCK_REWARD);
            paid = true;
        } catch {
        }
        if (paid) emit BlockRewardsPaid(block.number, proposer, BLOCK_REWARD);
    }

    function payFees() external {
        uint oneDollar = 1e18;
        address voucher = address(0x000000000000000000000000000000000000100e);
        address USDST = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
        address validatorPool = address(0x100d); // FeeCollector address
        try { // try to use a voucher
            voucher.call("burn", address(this), 1000000000000000000);
        } catch { // if no voucher, pay in USDST
            ERC20_Template(USDST).transfer(validatorPool, oneDollar / 100);
        }
    }
}