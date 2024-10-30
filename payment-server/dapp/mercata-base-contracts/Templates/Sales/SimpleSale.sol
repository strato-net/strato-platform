pragma es6;
pragma strict;
import <a3f917a3663eb66dbaa657dfa60c1250b310729c>;

/// @title A representation of asset sale contract
contract SimpleSale is Sale {
    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentService[] _paymentServices
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {
    }
}
