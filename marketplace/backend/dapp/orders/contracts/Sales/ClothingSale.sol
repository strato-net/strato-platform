pragma es6;
pragma strict;
import <0e5223240c46b3022a73c5e589536d3781e5b93f>;

/// @title A representation of clothing sale contract
contract ClothingSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}
