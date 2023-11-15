pragma es6;
pragma strict;
import <1e23e3989728fa5fc5ca6d6d3cd01cdc889434f9>;

/// @title A representation of asset sale contract
contract CarbonSale is UTXOSale{
    constructor(address _assetToBeSold, SaleState _state, PaymentType _payment) UTXOSale(_assetToBeSold, _state, _payment){
    }
}
