pragma es6;
pragma strict;
import <d1cf1a8c249cdc9db6b9e0a337e708d9c4aacf11>;

/// @title A representation of asset sale contract
contract SimpleSale is Sale {
    constructor(
        address _assetToBeSold,
        uint _price,
        uint _quantity,
        address[] _paymentProviders
    ) Sale(_assetToBeSold, _price, _quantity, _paymentProviders) {
    }
}
