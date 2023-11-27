 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/orders/contracts/Order.sol";
import "./OrderStatus.sol";
import "/dapp/orders/contracts/OrderLine.sol";

contract OrderManager is RestStatus,OrderStatus{
  
    function createOrder(    
            string _orderId
        ,   string _buyerOrganization
        ,   string _sellerOrganization
        ,   uint _orderDate
        ,   uint _orderTotal
        ,   uint _orderShippingCharges
        ,   OrderStatus _status
        ,   uint _amountPaid
        ,   string _buyerComments
        ,   string _sellerComments
        ,   uint _createdDate
        ,   string _paymentSessionId
        ,   address _shippingAddress) public returns (uint256, address){
        return (RestStatus.CREATED, address(0x0));
    }

    function updateBuyerDetails(address _orderAddress,OrderStatus _status,string _buyerComments,uint _scheme) public returns (uint,string,string) {
        Order order = Order(_orderAddress);
        return (1, "hi", "hi");
    }

    function updateSellerDetails(address _orderAddress,OrderStatus _status,uint _fullfilmentDate,string _sellerComments,uint _scheme) public  returns (uint,string,string){
         Order order = Order(_orderAddress);
         return (1, "hi", "hi");
    }

    function getInventoriesAndAvailableQuantity(address _orderAddress,OrderStatus _status,string _comments,address[] _orderLines,bool _isBuyer)  public returns (uint,string,string) {
        Order order = Order(_orderAddress);
        return (1, "hi", "hi");
    }

    function addOrderLine(address _orderAddress,address _productId, address _inventoryId, uint _quantity, uint _pricePerUnit, uint _shippingCharges
    , uint _tax, uint _createdDate ) public  returns(uint256, address){
        Order order = Order(_orderAddress);
        return (0, _orderAddress);
    }

    function addOrderLineItems(address _orderLineId,string[] _items, uint _createdDate) public  returns(uint256, string, string){
        OrderLine_2 orderLine = OrderLine_2(_orderLineId);
        return orderLine.addOrderLineItems(_orderLineId,_items,_createdDate);
    }
}
