pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";
import "../Structs/Structs.sol";

abstract contract Sale is Utils, Structs { 

    Asset public assetToBeSold;
    decimal public price;
    uint public quantity;
    PaymentServiceInfo[] public paymentServices;
    mapping (string => mapping (string => uint)) paymentServicesMap;
    mapping (string => uint) lockedQuantity;
    uint totalLockedQuantity;
    bool isOpen;

    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentServiceInfo[] _paymentServices
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        require(_quantity > 0, "Quantity must be greater than 0");
        require(assetToBeSold.quantity() >= _quantity, "Cannot sell more units than what are owned.");
        price = _price;
        quantity = _quantity;
        totalLockedQuantity = 0;
        isOpen = true;
        _addPaymentServices(_paymentServices);
        assetToBeSold.attachSale();
    }

    modifier requireSeller(string action) {
        string sellersCommonName = assetToBeSold.ownerCommonName();
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = getCommonName(msg.sender);
        require(commonName == sellersCommonName, err);
    }

    modifier requirePaymentService(string action) {
        require(isPaymentService(msg.sender), "Only whitelisted payment services can perform " + action + ".");
        _;
    }

    modifier requireSellerOrPaymentService(string action) {
        string sellersCommonName = assetToBeSold.ownerCommonName();
        string commonName = getCommonName(msg.sender);
        bool isAuthorized = commonName == sellersCommonName
                         || isPaymentService(msg.sender);
        require(isAuthorized, "Only the seller, or payment service can perform " + action + ".");
        _;
    }

    function getLock (
        string _orderHash,
        address _purchaser
    ) internal returns (string) {
        return keccak256(
            string(this),
            _orderHash,
            string(_purchaser)
        );
    }

    function _addPaymentServices(PaymentServiceInfo[] _paymentServices) internal {
        for (uint i = 0; i < _paymentServices.length; i++) {
            PaymentServiceInfo p = _paymentServices[i];
            paymentServices.push(p);
            paymentServicesMap[p.serviceName][p.creator] = paymentServices.length;
        }
    }

    function _clearPaymentServices() internal {
        for(uint i = 0; i < paymentServices.length; i++) {
            paymentServicesMap[paymentServices[i].serviceName][paymentServices[i].creator] = 0;
            paymentServices[i].creator = "";
            paymentServices[i].serviceName = "";
        }
        paymentServices = [];
    }

    function isPaymentService(address _paymentService) public returns (bool) {
        string _serviceName = _paymentService.call("serviceName");
        return paymentServicesMap[_serviceName][_paymentService.creator] != 0;
    }

    function completeSale( string orderHash, address purchaser ) public virtual requirePaymentService("complete sale") returns (uint);

    function automaticTransfer(address _newOwner, decimal _price, uint _quantity, uint _transferNumber) public virtual returns (uint);

    function closeSale() external virtual returns (uint);

    function closeSaleIfEmpty() internal {
        if (quantity == 0 && totalLockedQuantity == 0) {
            close();
            isOpen = false;
        }
    }

    function _closeSale() internal virtual returns (uint) {
        close();
        isOpen = false;
        return RestStatus.OK;
    }

    function close() internal {
        try {
            assetToBeSold.closeSale();
        } catch {

        }
    }

    function lockQuantity(
        uint quantityToLock,
        string orderHash,
        address purchaser
    ) requirePaymentService("lock quantity") public {
        require(quantityToLock <= quantity, "Not enough quantity to lock");
        string lock = getLock(orderHash, purchaser);
        require(lockedQuantity[lock] == 0, "Order has already locked quantity in this asset.");
        quantity -= quantityToLock;
        lockedQuantity[lock] = quantityToLock;
        totalLockedQuantity += quantityToLock;
    }

    function takeLockedQuantity(string orderHash, address purchaser) internal returns (uint) {
        string lock = getLock(orderHash, purchaser);
        uint quantityToUnlock = lockedQuantity[lock];
        require(quantityToUnlock > 0, "There are no quantity to unlock for address " + string(purchaser));
        lockedQuantity[lock] = 0;
        totalLockedQuantity -= quantityToUnlock;
        return quantityToUnlock;
    }

    function getLockedQuantity(string orderHash, address purchaser) public returns (uint) {
        string lock = getLock(orderHash, purchaser);
        return lockedQuantity[lock];
    }

    function unlockQuantity(
        string orderHash,
        address purchaser
    ) requireSellerOrPaymentService("unlock quantity") public {
        uint quantityToReturn = takeLockedQuantity(orderHash, purchaser);
        quantity += quantityToReturn;
    }

    function _cancelOrder(
        string orderHash,
        address purchaser
    ) internal returns (uint) {
        unlockQuantity(orderHash, purchaser);
        return RestStatus.OK;
    }

    function _update(
        uint _quantity,
        decimal _price,
        PaymentServiceInfo[] _paymentServices,
        uint _scheme
    ) internal returns (uint) {

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        require(_quantity + totalLockedQuantity <= assetToBeSold.quantity(), "Cannot sell more units than owned");
        quantity = _quantity;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        price = _price;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        _clearPaymentServices();
        _addPaymentServices(_paymentServices);
      }
      return RestStatus.OK;
    }
}
