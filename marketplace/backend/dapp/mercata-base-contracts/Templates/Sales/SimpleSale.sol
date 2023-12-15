pragma es6;
pragma strict;
import <a3d9911aeffee71e0c6cd37946d80f3864b49d45>;

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
