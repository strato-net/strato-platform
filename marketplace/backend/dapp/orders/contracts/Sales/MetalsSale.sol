pragma es6;
pragma strict;
import <4244a06baf12f75617016f4785897ab80e4daf3c>;

/// @title A representation of metals sale contract
contract MetalsSale is UTXOSale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price, uint _quantity) UTXOSale(_assetToBeSold, _payment, _price, _quantity){
    }
}
