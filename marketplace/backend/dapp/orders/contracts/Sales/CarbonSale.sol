pragma es6;
pragma strict;
import <bbcd8ec0bf0cdf0c17b4123429893df42692052a>;

/// @title A representation of asset sale contract
contract CarbonSale is Sale {
    constructor(
        address _assetToBeSold,
        uint _price,
        address[] _paymentProviders,
        uint _quantity
    ) Sale(_assetToBeSold, _price, _paymentProviders, _quantity) {
    }
}