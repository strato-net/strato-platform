pragma es6;
pragma strict;
import <BASE_CODE_COLLECTION>;

/// @title A representation of asset escrow contract
contract Escrow is Sale {
    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentService[] _paymentServices
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {
        governance = msg.sender;
    }

    function closeSale() external override requirePaymentService("complete sale") returns (uint) {
        _closeSale();
    }
}
