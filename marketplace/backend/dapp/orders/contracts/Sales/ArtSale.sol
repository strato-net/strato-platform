pragma es6;
pragma strict;
import <904f9336947055bfab86992930f3bc4a6637035f>;

/// @title A representation of art sale contract
contract ArtSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }
}