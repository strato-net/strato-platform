pragma es6;
pragma strict;
import <e206b22155d4958e9133fedb39dad88f0402df2d>;

/// @title A representation of metals sale contract
contract MetalsSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}
