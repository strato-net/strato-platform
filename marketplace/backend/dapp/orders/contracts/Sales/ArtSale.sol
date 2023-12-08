pragma es6;
pragma strict;
import <23b42b72d97bb074316c5db4fdae6165346742f5>;

/// @title A representation of art sale contract
contract ArtSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}