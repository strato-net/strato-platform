pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Enums/RestStatus.sol";
import "../Enums/SaleState.sol";
import "../Orders/Order.sol";
import "../Payments/PaymentProvider.sol";
import "../Utils/Utils.sol";

abstract contract Sale is SaleState, Utils { 
    Asset public assetToBeSold;
    uint public price;
    uint public quantity;
    SaleState public state;
    address[] public paymentProviders;
    mapping (address => uint) paymentProvidersMap;
    mapping (address => uint) lockedQuantity;

    constructor(
        address _assetToBeSold,
        uint _price,
        uint _quantity,
        address[] _paymentProviders
    ) {    
        assetToBeSold = Asset(_assetToBeSold);
        price = _price;
        require(assetToBeSold.quantity() >= _quantity, "Cannot sell more units than what are owned.");
        quantity = _quantity;
        state = SaleState.Created;
        addPaymentProviders(_paymentProviders);
        assetToBeSold.attachSale();
    }

    modifier requireSeller(string action) {
        string sellersCommonName = assetToBeSold.ownerCommonName();
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = getCommonName(tx.origin);
        require(commonName == sellersCommonName, err);
    }

    function changePrice(uint _price) public requireSeller("change price"){
        price=_price;
    }

    function addPaymentProviders(address[] _paymentProviders) public requireSeller("add payment providers") {
        for (uint i = 0; i < _paymentProviders.length; i++) {
            address p = _paymentProviders[i];
            paymentProviders.push(p);
            paymentProvidersMap[p] = paymentProviders.length;
        }
    }

    function removePaymentProviders(address[] _paymentProviders) public requireSeller("remove payment providers") {
        for (uint i = 0; i < _paymentProviders.length; i++) {
            address p = _paymentProviders[i];
            uint x = paymentProvidersMap[p];
            if (x > 0) {
                paymentProviders[x-1] = address(0);
                paymentProvidersMap[p] = 0;
            }
        }
    }

    function clearPaymentProviders() public requireSeller("clear payment providers") {
        for (uint i = 0; i < paymentProviders.length; i++) {
            paymentProvidersMap[paymentProviders[i]] = 0;
            paymentProviders[i] = address(0);
        }
        paymentProviders = [];
    }

    function isPaymentProvider(address _paymentProvider) public returns (bool) {
        return paymentProvidersMap[_paymentProvider] != 0;
    }

    function completeSale(
    ) public requireSeller("complete sale") returns (uint) {
        Order order = Order(msg.sender);
        address purchaser = order.purchasersAddress();
        uint orderQuantity = takeLockedQuantity(msg.sender);
        assetToBeSold.transferOwnership(purchaser, orderQuantity);
        return RestStatus.OK;
    }

    function closeSale() public requireSeller("close sale") returns (uint) {
        try {
            assetToBeSold.closeSale();
        } catch {

        }
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    function lockQuantity(uint quantityToLock) public {
        require(quantityToLock <= quantity, "Not enough quantity to lock");
        require(lockedQuantity[msg.sender] == 0, "Order has already locked quantity in this asset.");
        quantity -= quantityToLock;
        lockedQuantity[msg.sender] = quantityToLock;
    }

    function takeLockedQuantity(address orderAddress) internal returns (uint) {
        uint quantityToUnlock = lockedQuantity[orderAddress];
        require(quantityToUnlock > 0, "There are no quantity to unlock for address " + string(orderAddress));
        lockedQuantity[orderAddress] = 0;
        return quantityToUnlock;
    }

    function unlockQuantity() public {
        uint quantityToReturn = takeLockedQuantity(msg.sender);
        quantity += quantityToReturn;
    }

    function cancelOrder() public requireSeller("cancel order") returns (uint) {
        unlockQuantity();
        return RestStatus.OK;
    }
}