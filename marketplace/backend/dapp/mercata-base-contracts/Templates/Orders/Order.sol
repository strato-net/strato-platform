pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Sales/Sale.sol";

abstract contract Order is Utils {
    enum OrderStatus {
        NULL,
        AWAITING_FULFILLMENT,
        AWAITING_SHIPMENT,
        CLOSED,
        CANCELED,
        PAYMENT_PENDING,
        MAX
    }

    uint public orderId;
    address[] public saleAddresses;
    uint[] public quantities;
    bool[] public completedSales;
    uint outstandingSales;
    address public purchasersAddress;
    string public purchasersCommonName;
    string public sellersCommonName;
    uint public createdDate;
    uint public totalPrice;
    OrderStatus public status;
    uint public shippingAddressId;
    string public paymentSessionId;
    uint public fulfillmentDate;
    string public comments;

    event OrderCompleted(uint fulfillmentDate, string comments);

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        uint[] _quantities,
        uint _createdDate,
        uint _shippingAddressId,
        string _paymentSessionId,
        OrderStatus _status
    ) external{
        require(_saleAddresses.length == _quantities.length, "Number of sales doesn't match number of quantities.");
        orderId = _orderId;
        purchasersAddress = msg.sender;
        purchasersCommonName = getCommonName(msg.sender);
        createdDate = _createdDate;
        totalPrice = 0;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            address a = _saleAddresses[i];
            Sale s = Sale(a);
            string _sellersCommonName = s.assetToBeSold().ownerCommonName();
            if (sellersCommonName == "") {
                sellersCommonName = _sellersCommonName;
            } else {
                require(sellersCommonName == _sellersCommonName, "Cannot create order from multiple sellers.");
            }
            uint q = _quantities[i];
            s.lockQuantity(q);
            totalPrice += s.price() * q;
            saleAddresses.push(a);
            completedSales.push(false);
            quantities.push(q);
            outstandingSales++;
        }
        status = _status;
        shippingAddressId = _shippingAddressId;
        paymentSessionId = _paymentSessionId;
    }

    function completeOrder(uint _fulfillmentDate, string _comments) external returns (uint) {
        require(status != OrderStatus.CLOSED && status != OrderStatus.CANCELED, "Order already closed.");
        for (uint i = 0; i < saleAddresses.length; i++) {
            if (!completedSales[i]) {
                Sale(saleAddresses[i]).completeSale();
                completedSales[i] = true;
                outstandingSales--;
            }
        }
        if (outstandingSales == 0) {
            fulfillmentDate = _fulfillmentDate;
            comments = _comments;
            emit OrderCompleted(_fulfillmentDate, _comments);
            status = OrderStatus.CLOSED;
        }
        return RestStatus.OK;
    }

    function updateComment(string _comments) external returns (uint) {
        require(status != OrderStatus.CLOSED && status != OrderStatus.CANCELED, "Order already closed.");
        comments = _comments;

        return RestStatus.OK;
    }

    function unlockSales() internal {
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale s = Sale(saleAddresses[i]);
            try {
                s.unlockQuantity();
            } catch {

            }
        }
    }

    function updateOrderStatus(OrderStatus _status) external returns (uint) {
        require((tx.origin == purchasersAddress || getCommonName(tx.origin) == sellersCommonName), "Only the purchaser/seller can update the order status");
        if(status == OrderStatus.AWAITING_FULFILLMENT){
            if (_status == OrderStatus.AWAITING_SHIPMENT) {
                status = _status;
            } 
        }else if(status == OrderStatus.AWAITING_SHIPMENT){
            if (_status == OrderStatus.CLOSED) {
                status = _status;
            } 
        }else if(status == OrderStatus.PAYMENT_PENDING){
            if (_status == OrderStatus.AWAITING_FULFILLMENT) {
                status = _status;
            } 
        }
        return RestStatus.OK;
    }

    function onCancel(string _comments) internal virtual {}

    function cancelOrder(string _comments) external returns (uint) {
        require(status != OrderStatus.CLOSED && status != OrderStatus.CANCELED, "Order already closed.");
        require((tx.origin == purchasersAddress || getCommonName(tx.origin) == sellersCommonName), "Only the purchaser/seller can cancel the order");
        onCancel(_comments);
        unlockSales();
        status = OrderStatus.CANCELED;
        return RestStatus.OK;
    }
}