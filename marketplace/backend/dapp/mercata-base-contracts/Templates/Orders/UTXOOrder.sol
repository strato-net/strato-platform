pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "Order.sol";
import "../Sales/UTXOSale.sol";

abstract contract UTXOOrder is RestStatus, OrderStatus, Order {
    uint[] units;

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress,
        string _paymentSessionId,
        uint[] _units
    ) Order (
        _orderId,
        _saleAddresses, 
        _purchasersAddress,
        _createdDate,
        _totalPrice,
        _shippingAddress,
        _paymentSessionId
    )
    external {
        require(_saleAddresses.length == _units.length, "Units must match list of Sale contracts");
        // TODO?: We should be able to just write `units = _units;`
        for (uint i = 0; i < _units.length; i++) {
            units.push(_units[i]);
            UTXOSale(_saleAddresses[i]).lockUnits(_units[i]);
        }
    }

    function onCancel() internal override {
        for (uint i = 0; i < saleAddresses.length; i++) {
            UTXOSale(saleAddresses[i]).unlockUnits();
        }
    }
}
