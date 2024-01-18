pragma es6;
pragma strict;
import <8f8d4cef7232db7001bae657db85eb4325ee2f3d>;

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
