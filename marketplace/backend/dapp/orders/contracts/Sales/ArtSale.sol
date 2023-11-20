pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of art sale contract
contract ArtSale is Sale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price) Sale(_assetToBeSold, _price, _payment){
    }

    function transferOwnership(address _purchasersAddress, uint _orderId) public requireSeller("transfer ownership of Asset") returns (uint) {
        saleOrderID = _orderId;
        assetToBeSold.transferOwnership(address(this), _purchasersAddress);
        return RestStatus.OK;
    }
}