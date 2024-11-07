pragma es6;
pragma strict;

import <77e711f3ade487281584b641170d6df5380036b7>;
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
