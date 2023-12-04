pragma es6;
pragma strict;
import <afa8348e8e0305b2ac801b0ea20790bd7b638554>;

/// @title A representation of metals sale contract
contract MetalsSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}
