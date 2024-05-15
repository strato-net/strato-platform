pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Assets/UTXO.sol";
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

abstract contract Sale is Utils { 
    Asset public assetToBeSold;
    uint public price;
    uint public quantity;
    address[] public paymentProviders;
    mapping (address => uint) paymentProvidersMap;
    mapping (address => mapping (address => uint)) lockedQuantity;
    uint totalLockedQuantity;
    bool isOpen;

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
        totalLockedQuantity = 0;
        isOpen = true;
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
        string commonName = getCommonName(msg.sender);
        require(commonName == sellersCommonName, err);
    }

    modifier requirePaymentProvider(string action) {
        require(isPaymentProvider(msg.sender), "Only whitelisted payment providers can perform " + action + ".");
        _;
    }

    modifier requireSellerOrPaymentProvider(string action) {
        string sellersCommonName = assetToBeSold.ownerCommonName();
        string commonName = getCommonName(msg.sender);
        bool isAuthorized = commonName == sellersCommonName
                         || isPaymentProvider(msg.sender);
        require(isAuthorized, "Only the seller, or payment provider can perform " + action + ".");
        _;
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
        address purchaser,
        address[] _utxoAddressesPerSale
    ) public requirePaymentProvider("complete sale") returns (uint) {
        uint orderQuantity = takeLockedQuantity(purchaser);

        uint groupedQuantity = UTXO.combineUTXOs(_utxoAddressesPerSale);
        
        // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice: 0
        try {
            assetToBeSold.transferOwnership(purchaser, orderQuantity, false, 0, 0);
        } catch { // Backwards compatibility for old assets
            address(assetToBeSold).call("transferOwnership", purchaser, orderQuantity, false, 0);
        }        
        assetToBeSold.setQuantity(assetToBeSold.quantity() + groupedQuantity);
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function automaticTransfer(address _newOwner, uint _price, uint _quantity, uint _transferNumber) public returns (uint) {
        require(msg.sender == address(assetToBeSold), "Only the underlying Asset can call automaticTransfer.");
        uint assetQuantity = assetToBeSold.quantity();
        require(_quantity <= assetQuantity - totalLockedQuantity, "Cannot transfer more units than are available.");
        if (_quantity > quantity) { // We can transfer more than the Sale quantity
            quantity = 0;
        } else {
            quantity -= _quantity;
        }
        // transfer feature - isUserTransfer: true, transferNumber: _transferNumber, transferPrice: _price
        try {
            assetToBeSold.transferOwnership(_newOwner, _quantity, true, _transferNumber, _price);
        } catch { // Backwards compatibility for old assets
            address(assetToBeSold).call("transferOwnership", _newOwner, _quantity, true, _transferNumber);
        }
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function closeSaleIfEmpty() internal {
        if (quantity == 0 && totalLockedQuantity == 0) {
            close();
            isOpen = false;
        }
    }

    function closeSale() public requireSeller("close sale") returns (uint) {
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
        address purchaser
    ) requirePaymentProvider("lock quantity") public {
        require(quantityToLock <= quantity, "Not enough quantity to lock");
        require(lockedQuantity[msg.sender][purchaser] == 0, "Order has already locked quantity in this asset.");
        quantity -= quantityToLock;
        lockedQuantity[msg.sender][purchaser] = quantityToLock;
        totalLockedQuantity += quantityToLock;
    }

    function takeLockedQuantity(address orderAddress) internal returns (uint) {
        uint quantityToUnlock = lockedQuantity[msg.sender][orderAddress];
        require(quantityToUnlock > 0, "There are no quantity to unlock for address " + string(orderAddress));
        lockedQuantity[msg.sender][orderAddress] = 0;
        totalLockedQuantity -= quantityToUnlock;
        return quantityToUnlock;
    }

    function getLockedQuantity(address orderAddress) public returns (uint) {
        return lockedQuantity[msg.sender][orderAddress];
    }

    function unlockQuantity(
        address purchaser
    ) requireSellerOrPaymentProvider("unlock quantity") public {
        uint quantityToReturn = takeLockedQuantity(purchaser);
        quantity += quantityToReturn;
    }

    function cancelOrder(
        address purchaser
    ) public requireSellerOrPaymentProvider("cancel order") returns (uint) {
        unlockQuantity(purchaser);
        return RestStatus.OK;
    }

    function update(
        uint _quantity,
        uint _price,
        address[] _paymentProviders,
        uint _scheme
    ) returns (uint) {

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
        clearPaymentProviders();
        addPaymentProviders(_paymentProviders);
      }
      return RestStatus.OK;
    }
}