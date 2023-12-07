pragma es6;
pragma strict;

import <509>;
import "../Enums/OrderStatus.sol";
import "../Enums/RestStatus.sol";
import "../Sales/Sale.sol";

contract Order is OrderStatus, Utils {
    uint public orderId;
    address[] public saleAddresses;
    mapping (address => uint) saleMap;
    uint[] public quantities;
    bool[] public completedSales;
    uint outstandingSales;
    address public purchasersAddress;
    string public purchasersCommonName;
    uint public createdDate;
    uint public totalPrice;
    OrderStatus public status;
    string public shippingAddress;
    string public paymentSessionId;

    event SaleCompleted(uint fulfillmentDate, string comments);

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
            uint q = _quantities[i];
            s.lockQuantity(q);
            totalPrice += s.price() * q;
            saleAddresses.push(a);
            saleMap[a] = saleAddresses.length;
            completedSales.push(false);
            quantities.push(q);
            outstandingSales++;
        }
        status = OrderStatus.AWAITING_FULFILLMENT;
        shippingAddress = _shippingAddress;
    }

    function saleCompleted(uint _fulfillmentDate, string _comments) external returns (uint) {
        require(status != OrderStatus.CLOSED, "Order already closed.");
        uint index = saleMap[msg.sender];
        if (index > 0 && !completedSales[index - 1]) {
            completedSales[index - 1] = true;
            outstandingSales--;
            emit SaleCompleted(_fulfillmentDate, _comments);
        }
        if (outstandingSales == 0) {
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
    
    function completeOrder() external returns (uint) {
        status = OrderStatus.CLOSED;
        unlockSales();
        return RestStatus.OK;
    }

    function onCancel() internal virtual {}

    function cancelOrder() external {
        require(tx.origin == purchasersAddress, "Only the purchaser can cancel the order");
        onCancel();
        unlockSales();
        status = OrderStatus.CANCELED;
    }
}