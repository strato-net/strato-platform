import <dec1de02>;

contract record PayFeesWithVoucher {
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