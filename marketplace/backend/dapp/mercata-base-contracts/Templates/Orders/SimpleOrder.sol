pragma es6;
pragma strict;
import <cb12755ba7a59561f5d6def5b53e6282ccdab802>;

contract SimpleOrder is Order {
    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        uint[] _quantities,
        uint _createdDate,
        uint _shippingAddressId,
        string _paymentSessionId,
        OrderStatus _status
    ) Order (
        _orderId,
        _saleAddresses,
        _quantities,
        _createdDate,
        _shippingAddressId,
        _paymentSessionId,
        _status
    ) {
    }
    function onCancel(string _comments) internal override {
        comments= _comments;
    }

        
}