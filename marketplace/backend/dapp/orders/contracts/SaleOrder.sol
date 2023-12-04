pragma es6;
pragma strict;
import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

contract SaleOrder is Order {

    constructor(
        uint _orderId,
        address[] _saleAddresses,
        string _sellersCommonName,
        address _sellersAddress,
        string _purchasersCommonName,
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress,
        string _paymentSessionId
    ) external Order(
        _orderId, 
        _saleAddresses, 
        _sellersCommonName, 
        _sellersAddress,
        _purchasersCommonName, 
        _purchasersAddress, 
        _createdDate, 
        _totalPrice,
        _shippingAddress,
        _paymentSessionId
        ){

    }

}