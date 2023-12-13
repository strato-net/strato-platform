pragma es6;
pragma strict;
import <86483be23fa65cf7f992d9cb35eca840e74090bc>;

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