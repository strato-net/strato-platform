import <dec1deff>;

contract record PayFeesWithVoucher {
    function payFees() external {
        uint oneDollar = 1e18;
        address voucher = address(0xa96c02a13b558fbcf923af1d586967cf7f55c753);
        address USDST = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
        address validatorPool = address(0x1234);
        try { // try to use a voucher
            voucher.call("burn", address(this), 1000000000000000000);
        } catch { // if no voucher, pay in USDST
            ERC20_Template(USDST).transfer(validatorPool, oneDollar / 100);
        }
    }
}