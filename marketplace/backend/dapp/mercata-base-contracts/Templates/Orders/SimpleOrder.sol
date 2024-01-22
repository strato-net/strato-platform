pragma es6;
pragma strict;
import <d1cf1a8c249cdc9db6b9e0a337e708d9c4aacf11>;

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