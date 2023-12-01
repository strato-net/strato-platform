pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of clothing sale contract
contract ClothingSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}
