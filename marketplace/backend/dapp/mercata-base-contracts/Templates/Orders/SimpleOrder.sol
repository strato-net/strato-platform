pragma es6;
pragma strict;
import <b63644c5e28bb14f2c6f420c8adf318272a419cd>;

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