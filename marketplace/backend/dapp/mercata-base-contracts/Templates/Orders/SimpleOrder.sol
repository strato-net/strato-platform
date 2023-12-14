pragma es6;
pragma strict;
import <787dbd85880c9c4c238dd7ef4b4b1b8c8f0eb95f>;

contract SimpleOrder is Order {
    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        uint[] _quantities,
        uint _createdDate,
        string _shippingAddress
    ) Order (
        _orderId,
        _saleAddresses,
        _quantities,
        _createdDate,
        _shippingAddress
    ) {
    }
}