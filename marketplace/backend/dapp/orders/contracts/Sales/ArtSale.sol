pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of art sale contract
contract ArtSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}