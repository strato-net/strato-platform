pragma es6;
pragma strict;
import <e206b22155d4958e9133fedb39dad88f0402df2d>;

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