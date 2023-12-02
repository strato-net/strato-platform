pragma es6;
pragma strict;

import <509>;
import "../Enums/OrderStatus.sol";
import "../Enums/RestStatus.sol";
import "../Sales/Sale.sol";

abstract contract Order is RestStatus, OrderStatus, Utils {
    uint public orderId;
    address[] public saleAddresses;
    string public purchasersCommonName;
    address public purchasersAddress;
    uint public createdDate;
    uint public totalPrice;
    OrderStatus public status;
    address public shippingAddress;
    uint public fulfillmentDate;
    string public paymentSessionId;
    string public comments;

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        address _purchasersAddress,
        uint _createdDate,
        uint _totalPrice,
        address _shippingAddress,
        string _paymentSessionId
    ) external{
        orderId = _orderId;
        saleAddresses = _saleAddresses;
        purchasersAddress = _purchasersAddress;
        purchasersCommonName = getCommonName(_purchasersAddress);
        createdDate = _createdDate;
        totalPrice = _totalPrice;
        status = OrderStatus.AWAITING_FULFILLMENT;
        shippingAddress = _shippingAddress;
    }
    
    function transferOwnership(uint _fulfillmentDate, string _comments) external returns (uint) {
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale sale = Sale(saleAddresses[i]);
            // Perform the ownership transfer
            sale.transferOwnership(purchasersAddress, orderId);
        }
        fulfillmentDate = _fulfillmentDate;
        comments = _comments;
        status = OrderStatus.CLOSED;
        return RestStatus.OK;
    }

    function onCancel() internal virtual {}

    function cancelOrder() external {
        require(tx.origin == purchasersAddress, "Only the purchaser can cancel the order");
        onCancel();
        status = OrderStatus.CANCELED;
    }
}