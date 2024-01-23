pragma es6;
pragma strict;
import <a560e2e8d58da359d4df3a1ac2692f38e0be3009>;

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