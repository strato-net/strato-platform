pragma es6;
pragma strict;
import <1e23e3989728fa5fc5ca6d6d3cd01cdc889434f9>;

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