pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of clothing sale contract
contract ClothingSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, _price) Sale(_assetToBeSold, _price, _payment){
    }
}
