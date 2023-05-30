 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/orders/contracts/Order.sol";
import "./OrderStatus.sol";
import "/dapp/orders/contracts/OrderLine.sol";
// import "/dapp/permissions/app/contracts/AppPermissionManager.sol";
import "/dapp/products/contracts/Inventory.sol";
import "/dapp/products/contracts/ProductManager.sol";

contract OrderManager is RestStatus,OrderStatus{
    // AppPermissionManager appPermissionManager;

    //  constructor(address _permissionManager) public {
    //  appPermissionManager=AppPermissionManager(_permissionManager);
    // }

    constructor() public {}

    struct OrderList{
        address inventoryId;
        uint quantity;
    }

    mapping( address => mapping(uint => uint)) inventoryQuantity;

    // function createOrder(    
    //         string _orderId
    //     ,   string _buyerOrganization
    //     ,   string _sellerOrganization
    //     ,   uint _orderDate
    //     ,   uint _orderTotal
    //     ,   uint _orderShippingCharges
    //     ,   OrderStatus _status
    //     ,   uint _amountPaid
    //     ,   string _buyerComments
    //     ,   string _sellerComments
    //     ,   uint _createdDate
    //     ,   string _paymentSessionId
    //     ,   address _shippingAddress) public returns (uint256, address){
    //     Order order = new Order( _orderId, _buyerOrganization,_sellerOrganization, _orderDate,_orderTotal,_orderShippingCharges,_status,_amountPaid,_buyerComments,_sellerComments,_createdDate,_paymentSessionId,_shippingAddress);
    //     return (RestStatus.CREATED, address(order));
    // }

    function createOrder(string _orderId, string _buyerOrganization, OrderList[] _orderList, uint _orderTotal,
     string _paymentSessionId, address _shippingAddress, uint _orderDate, uint _createdDate, uint _shippingCharges, uint _tax) public returns (uint, string){
        
        uint orderTotal;
        uint amountPaid;
        string sellerOrganization;
        uint orderShippingCharges;
        uint tax;
        OrderStatus status;
        string buyerComments;
        string sellerComments;

        uint inventoryTotal;
        address[] inventoryIdArray;
        int[] inventoryQuantityArray;

        for (uint i = 0; i < _orderList.length; i++) {
            Inventory inventory = Inventory(address(_orderList[i].inventoryId));

            if (_buyerOrganization == inventory.ownerOrganization()) {
                return(RestStatus.BAD_REQUEST, "Seller can not buy his own product");
            }
            inventoryQuantity[address(_orderList[i].inventoryId)][i] = _orderList[i].quantity;
            inventoryTotal += uint(inventory.pricePerUnit()) * uint(inventoryQuantity[address(_orderList[i].inventoryId)][i]);

            sellerOrganization = inventory.ownerOrganization();
            orderShippingCharges =  inventoryTotal * _shippingCharges;
            tax =  inventoryTotal * _tax;
            OrderStatus status =  OrderStatus.AWAITING_FULFILLMENT;
            buyerComments = '';
            sellerComments = '';

            inventoryIdArray.push(address(_orderList[i].inventoryId));
            inventoryQuantityArray.push(int(_orderList[i].quantity));
        }

        if (inventoryTotal != _orderTotal) {
            return (RestStatus.BAD_REQUEST, "Order Total is not matching");
        }
        orderTotal = inventoryTotal + orderShippingCharges + tax;
        amountPaid = orderTotal;

        Order order = new Order( _orderId,  _buyerOrganization, sellerOrganization, _orderDate, orderTotal, orderShippingCharges, status,
         amountPaid, buyerComments, sellerComments, _createdDate, _paymentSessionId, _shippingAddress);

        for (uint j = 0; j < _orderList.length; j++) {
            Inventory inventory = Inventory(address(_orderList[j].inventoryId));

            uint shippingCharges = (uint(inventory.pricePerUnit()) * uint(inventoryQuantity[address(_orderList[j].inventoryId)][j])) * _shippingCharges;
            uint tax = (uint(inventory.pricePerUnit()) * uint(inventoryQuantity[address(_orderList[j].inventoryId)][j])) * _tax;

            addOrderLine(address(order), inventory.productId(), address(inventory), uint(inventory.quantity()), uint(inventory.pricePerUnit()), shippingCharges, tax, _createdDate );
        }

        ProductManager.updateInventoriesQuantities(inventoryIdArray, inventoryQuantityArray, false);
        return (201, string(address(order)));
    }

     // function updateBuyerDetails(address _orderAddress,OrderStatus _status,string _buyerComments,uint _scheme) public returns (uint,string,string) {
    //     Order order = Order(_orderAddress);
    //     return order.updateBuyerDetails(_status,_buyerComments,_scheme);
    // }

    // function updateSellerDetails(address _orderAddress,OrderStatus _status,uint _fullfilmentDate,string _sellerComments,uint _scheme) public  returns (uint,string,string){
    //      Order order = Order(_orderAddress);
    //      return order.updateSellerDetails(_status,_fullfilmentDate,_sellerComments,_scheme);
    // } 

     function updateOrderDetails(address _orderAddress,string _type,OrderStatus _status,uint _fullfilmentDate,string _comments,uint _scheme, address _dappAddress, address[] _itemAddresses) public  returns (uint,string,string){
         Order order = Order(_orderAddress);
         return order.updateDetails(_type,_status,_fullfilmentDate,_comments,_scheme,_dappAddress,_itemAddresses);
    }

    function getInventoriesAndAvailableQuantity(address _orderAddress,OrderStatus _status,string _comments,address[] _orderLines,bool _isBuyer)  public returns (uint,address[],int[]) {
        Order order = Order(_orderAddress);
        return order.getInventoriesAndAvailableQuantity(_status,_comments,_orderLines,_isBuyer);
    }

    function addOrderLine(address _orderAddress,address _productId, address _inventoryId, uint _quantity, uint _pricePerUnit, uint _shippingCharges
    , uint _tax, uint _createdDate ) public  returns(uint256, address){
        Order order = Order(_orderAddress);
        return order.addOrderLine(_orderAddress,_productId,_inventoryId,_quantity,_pricePerUnit,_shippingCharges,_tax,_createdDate);
    }

    function addOrderLineItems(address _orderLineId,string[] _items, uint _createdDate) public  returns(uint256, string, string){
        OrderLine_2 orderLine = OrderLine_2(_orderLineId);
        return orderLine.addOrderLineItems(_orderLineId,_items,_createdDate);
    }
}
