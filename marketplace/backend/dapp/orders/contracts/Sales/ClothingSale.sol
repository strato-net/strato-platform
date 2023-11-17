pragma es6;
pragma strict;
import <d85f8ab0f5bb3add2046fd57ba9ba3ef3823d005>;

/// @title A representation of asset sale contract
contract ClothingSale is Sale{
    constructor(address _assetToBeSold, SaleState _state, PaymentType _payment, _price) Sale(_assetToBeSold, _price ,_state, _payment){
    }
}
