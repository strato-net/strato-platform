pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

contract SaleOrder is Order {

    constructor(
        uint _orderId,
        address[] _saleAddresses,
        string _sellerCommonName,
        string _purchasersCommonName,
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress
    ) external Order(
        _orderId, 
        _saleAddresses, 
        _sellerCommonName, 
        _purchasersCommonName, 
        _purchasersAddress, 
        _createdDate, 
        _totalPrice,
        _shippingAddress
        ){

    }

}