pragma es6;
pragma strict;
import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

/// @title A representation of art sale contract
contract ArtSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}