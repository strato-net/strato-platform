pragma es6;
pragma strict;


/// @title A representation of asset sale contract
contract TokenOffer is Offer, Utils {
    constructor(
        address _assetToBeSold,
        address _sale,
        decimal _price,
        uint _quantity,
        address _purchaser
    ) Offer(_assetToBeSold, _sale, _price, _quantity, _purchaser) {
    }

    function _close() internal override {
        try {
            TokenPaymentService tokenPaymentService = TokenPaymentService(paymentService);
            uint balance = tokenPaymentService.balanceOf(purchaserCommonName);
            tokenPaymentService.transfer(purchaserCommonName, balance);
        } catch {

        }
    }

    function updateTokenBid(
        uint _quantity,
        decimal _price
    ) returns (uint) {
        TokenPaymentService tps = TokenPaymentService(paymentService);
        decimal currentBalance = decimal(tps.balance());
        decimal totalDollarPrice = _price * decimal(_quantity);
        decimal totalTokenPrice = totalDollarPrice * tps.tokensPerDollar() * (10 ** tps.decimals());
        string err = "Bid does not hold enough token balance to update";
        require(currentBalance >= totalTokenPrice, err);
        decimal refund = currentBalance - totalTokenPrice - 1.0;
        require(tps.transfer(purchaserCommonName, uint(refund)), err);
        quantity = _quantity;
        price = _price;
        return RestStatus.OK;
    }

    // Accept, Cancel, Reject
}
