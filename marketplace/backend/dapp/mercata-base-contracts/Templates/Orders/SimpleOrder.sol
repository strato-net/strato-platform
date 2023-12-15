pragma es6;
pragma strict;
import <eddd7c9aa884a3b1b8595f0897608c07a8e770b1>;

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