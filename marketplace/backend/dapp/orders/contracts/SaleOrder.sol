pragma es6;
pragma strict;
import <0e5223240c46b3022a73c5e589536d3781e5b93f>;

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