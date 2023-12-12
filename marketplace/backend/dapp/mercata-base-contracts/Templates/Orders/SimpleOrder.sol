pragma es6;
pragma strict;
import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

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