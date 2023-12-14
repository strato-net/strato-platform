pragma es6;
pragma strict;
import <a3d9911aeffee71e0c6cd37946d80f3864b49d45>;

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