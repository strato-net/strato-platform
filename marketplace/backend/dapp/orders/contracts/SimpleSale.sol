pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of asset sale contract
contract SimpleSale is Sale{
    constructor(address _assetToBeSold, SaleState _state, PaymentType _payment) Sale(_assetToBeSold, _state, _payment){
    }
}
