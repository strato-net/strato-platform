pragma es6;
pragma strict;
import <bbcd8ec0bf0cdf0c17b4123429893df42692052a>;

/// @title A representation of clothing sale contract
contract ClothingSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}
