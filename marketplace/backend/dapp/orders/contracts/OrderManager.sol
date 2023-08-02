import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/orders/contracts/Order.sol";
import "./OrderStatus.sol";
import "/dapp/orders/contracts/OrderLine.sol";

contract OrderManager is RestStatus, OrderStatus {
    function createOrder(
        string _orderId,
        string _buyerOrganization,
        string _sellerOrganization,
        uint _orderDate,
        uint _orderTotal,
        uint _orderShippingCharges,
        OrderStatus _status,
        uint _amountPaid,
        uint _createdDate,
        string _paymentSessionId,
        address _shippingAddress
    ) public returns (uint256, address) {
        Order order = new Order(
            _orderId,
            _buyerOrganization,
            _sellerOrganization,
            _orderDate,
            _orderTotal,
            _orderShippingCharges,
            _status,
            _amountPaid,
            _createdDate,
            _paymentSessionId,
            _shippingAddress
        );
        return (RestStatus.CREATED, address(order));
    }

    function updateBuyerDetails(
        address _orderAddress,
        OrderStatus _status,
        uint _scheme
    ) public returns (uint, string, string) {
        Order order = Order(_orderAddress);
        return order.updateBuyerDetails(_status, _scheme);
    }

    function updateSellerDetails(
        address _orderAddress,
        OrderStatus _status,
        uint _fullfilmentDate,
        uint _scheme
    ) public returns (uint, string, string) {
        Order order = Order(_orderAddress);
        return
            order.updateSellerDetails(
                _status,
                _fullfilmentDate,
                _scheme
            );
    }

    function getInventoriesAndAvailableQuantity(
        address _orderAddress,
        OrderStatus _status,
        address[] _orderLines,
        bool _isBuyer
    ) public returns (uint, string, string) {
        Order order = Order(_orderAddress);
        return
            order.getInventoriesAndAvailableQuantity(
                _status,
                _orderLines,
                _isBuyer
            );
    }

    function addOrderLine(
        address _orderAddress,
        address _productId,
        address _inventoryId,
        string _creditBatchSerialization,
        uint _quantity,
        uint _pricePerUnit,
        uint _tax,
        uint _createdDate
    ) public returns (uint256, address) {
        Order order = Order(_orderAddress);
        return
            order.addOrderLine(
                _orderAddress,
                _productId,
                _inventoryId,
                _creditBatchSerialization,
                _quantity,
                _pricePerUnit,
                _tax,
                _createdDate
            );
    }
}
