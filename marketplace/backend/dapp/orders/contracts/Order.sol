 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "../../../products/contracts/Inventory.sol";
import "./OrderStatus.sol";
import "/dapp/orders/contracts/OrderLine.sol";

/// @title A representation of Order assets
contract Order is OrderStatus {

    address public owner; 
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public orderId;
    string public buyerOrganization;
    string public sellerOrganization;
    uint public orderDate;
    uint public orderTotal;
    uint public orderShippingCharges;
    OrderStatus public status;
    uint public paymentDate;
    uint public amountPaid;
    uint public fullfilmentDate;
    string public buyerComments;
    string public sellerComments;
    uint public createdDate;
    string public paymentSessionId;
    address public shippingAddress;

    address[] orderLines;
    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
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
        ,   address _shippingAddress
    ) public {
        owner = tx.origin;

        orderId = _orderId;
        buyerOrganization = _buyerOrganization;
        sellerOrganization = _sellerOrganization;
        orderDate = _orderDate;
        orderTotal = _orderTotal;
        orderShippingCharges = _orderShippingCharges;
        status = OrderStatus.AWAITING_FULFILLMENT;
        amountPaid = _amountPaid;
        buyerComments = _buyerComments;
        sellerComments = _sellerComments;
        createdDate = _createdDate;
        paymentSessionId= _paymentSessionId;
        shippingAddress= _shippingAddress;
        
        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
        

    }

    function updateBuyerDetails(
        OrderStatus _status
        ,   string _buyerComments
    ,uint _scheme
    ) public returns (uint,string,string) {

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != buyerOrganization){
        return (RestStatus.FORBIDDEN,"","");
      }

       // check for open status to closed status
     if(_status == OrderStatus.CANCELED){
       return getInventoriesAndAvailableQuantity(_status,_buyerComments,orderLines,true);
     }

      if (_scheme == 0) {
        return (RestStatus.OK,"","");
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        changeStatus(_status);
      }

      if ((_scheme & (1 << 1)) == (1 << 1)) {
        buyerComments = _buyerComments;
      }

      return (RestStatus.OK,string(address(0)),string(address(0)));
    }

    function updateSellerDetails(
        OrderStatus _status
        ,   uint _fullfilmentDate
        ,   string _sellerComments
    ,uint _scheme
    ) public  returns (uint,string,string) {

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != sellerOrganization){
        return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
      } 

    // check for open status to closed status
     if(_status == OrderStatus.CLOSED){
       for(uint i=0;i<orderLines.length;i++){
        OrderLine_2 orderLine = OrderLine_2(orderLines[i]);
        // if(!orderLine.isSerialUploaded()){
        //   return (RestStatus.BAD_REQUEST,string(address(0)),string(address(0)));
        // }
      }
      fullfilmentDate = _fullfilmentDate;
      return getInventoriesAndAvailableQuantity(_status,_sellerComments,orderLines,false);
     }

      // check for open status to closed status
     if(_status == OrderStatus.CANCELED){
       return getInventoriesAndAvailableQuantity(_status,_sellerComments,orderLines,false);
     }


      if (_scheme == 0) {
        return (RestStatus.OK,"","");
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        changeStatus(_status);
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        fullfilmentDate = _fullfilmentDate;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        sellerComments = _sellerComments;
      }

      return (RestStatus.OK,"","");
    }

    // Add the orderLine of a order
    function addOrderLine(address _orderAddress, address _productId, address _inventoryId, uint _quantity, uint _pricePerUnit, uint _shippingCharges
, uint _tax, uint _createdDate ) public  returns(uint256, address){

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != buyerOrganization){
        return (RestStatus.FORBIDDEN,address(0));
      } 

      OrderLine_2 orderLine=new OrderLine_2(_orderAddress, _productId, _inventoryId, _quantity, _pricePerUnit, _shippingCharges
      , _tax, _createdDate);
      orderLines.push(address(orderLine));
      return (RestStatus.OK,address(orderLine));
    }

    function changeStatus(OrderStatus newStatus) public {
      if(status == OrderStatus.AWAITING_FULFILLMENT){
          if (newStatus == OrderStatus.AWAITING_SHIPMENT) {
              status = newStatus;
          } else if (newStatus == OrderStatus.CANCELED) {
              status = newStatus;
          }
      }else if(status == OrderStatus.AWAITING_SHIPMENT){
          if (newStatus == OrderStatus.CLOSED) {
              status = newStatus;
          } 
      }
    }

    function updateOrderStatus(OrderStatus _status) public{
      status = _status;
    }

    function getInventoriesAndAvailableQuantity(OrderStatus _status,string _comments,address[] _orderLines,bool _isBuyer) public returns(uint,string,string){

      changeStatus(_status);
      if(_isBuyer){
        buyerComments = _comments;
      }else{
        sellerComments = _comments;
      }
      string inventories = "";
      string orderLineQuantities = "";
      for(uint i=0;i<orderLines.length;i++){
        OrderLine_2 orderLine = OrderLine_2(address(orderLines[i]));
        Inventory_12 inventory = Inventory_12(address(orderLine.inventoryId()));
        inventories += string(address(orderLine.inventoryId())) + ",";
        orderLineQuantities += string(orderLine.quantity()) + ",";
      }
      return (RestStatus.OK,inventories,orderLineQuantities);
  
    }

   
    // ------------------- ASSET SHARD MEMBERSHIP FUNCTIONS ---------------

    // Add an organization to the chain
    function addOrg(string _orgName) {
      assert(tx.origin == owner);
      emit OrgAdded(_orgName);
    }

    // Add an organization unit to the chain
    function addOrgUnit(string _orgName, string _orgUnit) {
      assert(tx.origin == owner);
      emit OrgUnitAdded(_orgName, _orgUnit);
    }

    // Add a member to the chain
    function addMember(string _orgName, string _orgUnit, string _commonName) { 
      assert(tx.origin == owner);
      emit CommonNameAdded(_orgName, _orgUnit, _commonName); 
    } 

    // Remove an organization from the chain
    function removeOrg(string _orgName) {
      assert(tx.origin == owner);
      emit OrgRemoved(_orgName);
    }

    // Remove an organization unit from the chain
    function removeOrgUnit(string _orgName, string _orgUnit) {
      assert(tx.origin == owner);
      emit OrgUnitRemoved(_orgName, _orgUnit);
    }
    
    // Remove a member from the chain
    function removeMember(string _orgName, string _orgUnit, string _commonName) { 
      assert(tx.origin == owner);
      emit CommonNameRemoved(_orgName, _orgUnit, _commonName);  
    }

    // Bulk add organizations to the chain
    function addOrgs(string[] _orgNames) public returns (uint256) {
        assert(tx.origin == owner);
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addOrg(_orgNames[i]);
        }
        return RestStatus.OK;
    }

    // Bulk add organization units to the chain
    function addOrgUnits(string[] _orgNames, string[] _orgUnits) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addOrgUnit(_orgNames[i], _orgUnits[i]);
        }
        return RestStatus.OK;
    }

    // Bulk add members to the chain
    function addMembers(string[] _orgNames, string[] _orgUnits, string[] _commonNames ) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length && _orgUnits.length == _commonNames.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addMember(_orgNames[i], _orgUnits[i], _commonNames[i]);
        }
        return RestStatus.OK;
    }

    // Bulk remove organizations from the chain
    function removeOrgs(string[] _orgNames) public returns (uint256) {
        assert(tx.origin == owner);
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeOrg(_orgNames[i]);
        }
        return RestStatus.OK;
    }

    // Bulk remove organization units from the chain
    function removeOrgUnits(string[] _orgNames, string[] _orgUnits) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeOrgUnit(_orgNames[i], _orgUnits[i]);
        }
        return RestStatus.OK;
    }

    // Bulk remove members from the chain
    function removeMembers(string[] _orgNames, string[] _orgUnits, string[] _commonNames ) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length && _orgUnits.length == _commonNames.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeMember(_orgNames[i], _orgUnits[i], _commonNames[i]);
        }
        return RestStatus.OK;
    }


}
