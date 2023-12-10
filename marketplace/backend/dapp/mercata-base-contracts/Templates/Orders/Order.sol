pragma es6;
pragma strict;

import <509>;
import "../Enums/OrderStatus.sol";
import "../Enums/RestStatus.sol";
import "../Sales/Sale.sol";

abstract contract Order is OrderStatus, Utils {
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
    string public shippingAddress;
    string public paymentSessionId;
    uint public fulfillmentDate;
    string public comments;

    event OrderCompleted(uint fulfillmentDate, string comments);

    constructor(
        uint _orderId,
        address[] _saleAddresses, 
        uint[] _quantities,
        uint _createdDate,
        string _shippingAddress
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
        status = OrderStatus.AWAITING_FULFILLMENT;
        shippingAddress = _shippingAddress;
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

    function unlockSales() internal {
        for (uint i = 0; i < saleAddresses.length; i++) {
            Sale s = Sale(saleAddresses[i]);
            try {
                s.unlockQuantity();
            } catch {

            }
        }
    }

    function onCancel() internal virtual {}

    function cancelOrder() external returns (uint) {
        require(status != OrderStatus.CLOSED && status != OrderStatus.CANCELED, "Order already closed.");
        require(tx.origin == purchasersAddress, "Only the purchaser can cancel the order");
        onCancel();
        unlockSales();
        status = OrderStatus.CANCELED;
        return RestStatus.OK;
    }
}