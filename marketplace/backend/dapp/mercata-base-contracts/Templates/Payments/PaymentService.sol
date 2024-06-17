pragma es6;
pragma strict;

import <509>;
import "../Sales/Sale.sol";
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

abstract contract PaymentService is Utils {
    address public owner;
    string public ownerCommonName;

    bool public isActive;

    string public serviceName;
    string public imageURL;
    string public checkoutText;

    event SellerOnboarded (
        string sellersCommonName,
        bool isActive
    );

    enum PaymentStatus { NULL, ORDER_CREATED, PAYMENT_INITIALIZED, ORDER_COMPLETED, ORDER_CANCELLED }

    event Order (
        string orderHash,             /* Unique hash of the order details for payment server lookup to 
                                         avoid having to send all the order details in the request. */
        string orderId,               // Same orderId funtionality as the current marketplace
        address purchaser,            // Purchaser address on the blockchain for ownershipTransfer
        string purchasersCommonName,  // Purchaser common name for lookup purposes
        string sellersCommonName,     // Seller common name for lookup purposes
        address[] saleAddresses,      // List of the sale contracts for the assets in the order
        uint[] quantities,            // List of quantities for each asset being bought
        uint amount,                  // Total price of the order
        uint tax,                     // Tax
        int grossMargin,             // Gross margin used to calcualte cost basis
        uint unitsPerDollar,          // Amount of units per dollar for the currency (Ex: STRAT is 100 units per dollar)
        string currency,              // The type of currency used for the purchase
        PaymentStatus status,         // Status of the payment
        uint createdDate              // Date at the time of fresh order creation
    );

    address public purchasersAddress;   // ONLY USED FOR BACKWARDS COMPATIBILITY WITH SALE. DELETE ONCE ALL SALES USE NEW LOGIC!!!
    string public purchasersCommonName; // ONLY USED FOR BACKWARDS COMPATIBILITY WITH SALE. DELETE ONCE ALL SALES USE NEW LOGIC!!!

    constructor (
        string _serviceName,
        string _imageURL,
        string _checkoutText
    ) public {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        isActive = true;

        serviceName = _serviceName;
        imageURL = _imageURL;
        if (_checkoutText != "") {
            checkoutText = _checkoutText;
        } else {
            checkoutText = "Checkout with " + serviceName;
        }
    }

    modifier requireOwner(string action) {
        string err = "Only the owner can "
                   + action
                   + ".";
        require(getCommonName(msg.sender) == ownerCommonName, err);
        _;
    }

    modifier requireActive(string action) {
        string err = "The payment service must be active to "
                   + action
                   + ".";
        require(isActive, err);
        _;
    }

    function transferOwnership(address _newOwner) requireOwner("transfer ownership") external {
        owner = _newOwner;
        ownerCommonName = getCommonName(owner);
    }

    function deactivate() requireOwner("deactivate the payment service") external {
        isActive = false;
    }

    function getOrderHash (
        string _orderId,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities
    ) internal returns (string) {
        string salesString = "[";
        string quantitiesString = "[";
        for (uint i=0; i < _saleAddresses.length; i++) {
            if (i > 0) {
                salesString += ",";
                quantitiesString += ",";
            }
            salesString += string(_saleAddresses[i]);
            quantitiesString += string(_quantities[i]);
        }
        salesString += "]";
        quantitiesString += "]";
        string orderHash = keccak256(
            string(this),
            _purchasersCommonName,
            _orderId,
            salesString,
            quantitiesString
        );
        return orderHash;
    }

    function onboardSeller(
        string _sellersCommonName,
        bool _isActive
    ) requireOwner("onboard sellers") public returns (uint) {
        emit SellerOnboarded(_sellersCommonName, _isActive);
        return RestStatus.OK;
    }

    function offboardSeller(
        string _sellersCommonName
    ) requireOwner("offboard sellers") public returns (uint) {
        emit SellerOnboard(_sellersCommonName, false);
        return RestStatus.OK;
    }

    function createOrder (
        string _orderId,
        address[] _saleAddresses,
        uint[] _quantities,
        uint _createdDate
    ) requireActive("create order") external returns (string, address[]) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(msg.sender);
        string orderHash = getOrderHash(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        return _createOrder(
            orderHash,
            _orderId,
            msg.sender,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _createdDate
        );
    }

    function _createOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        uint _createdDate
    ) internal virtual returns (string, address[]) {
        address[] assets;
        uint totalAmount = 0;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            uint amount = s.price();
            uint quantity = _quantities[i];
            totalAmount += amount * quantity;
            seller = getCommonName(a.owner());
            try {
                s.lockQuantity(quantity, _purchaser);
            } catch { // Support for legacy sales
                _saleAddresses[i].call("lockQuantity", quantity);
            }
        }
        emit Order(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            "",
            PaymentStatus.ORDER_CREATED,
            _createdDate
        );
        return (_orderHash, assets);
    }

    function initializePayment (
        string _orderHash,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) requireActive("initialize payment") requireOwner("initialize payment") external returns (address[]){
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string orderHash = getOrderHash(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(orderHash == _orderHash, "Invalid order data");
        return _initializePayment(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _currency,
            _createdDate
        );
    }

    function _initializePayment (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) internal virtual returns (address[]){
        uint totalAmount = 0;
        address[] assets;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            totalAmount += s.price() * _quantities[i];
        }
        emit Order(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            _currency,
            PaymentStatus.PAYMENT_INITIALIZED,
            _createdDate
        );
        return assets;
    }

    function completeOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) requireActive("complete order") requireOwner("complete order") external returns (address[]) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string orderHash = getOrderHash(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(orderHash == _orderHash, "Invalid order data");
        return _completeOrder(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _currency,
            _createdDate
        );
    }

    function _completeOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) internal virtual returns (address[]) {
        uint totalAmount = 0;
        address[] assets;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            totalAmount += s.price() * _quantities[i];
            try {
                s.completeSale(_purchaser);
            } catch { // Support for legacy sales
                address(s).call("completeSale");
            }
        }
        emit Order(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            _currency,
            PaymentStatus.ORDER_COMPLETED,
            _createdDate
        );
        return assets;
    }

    function cancelOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) requireActive("cancel order") external {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string orderHash = getOrderHash(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(orderHash == _orderHash, "Invalid order data");
        string err = "Only the purchaser or owner can cancel the order.";
        string commonName = getCommonName(msg.sender);
        require(commonName == ownerCommonName || commonName == _purchasersCommonName, err);
        return _cancelOrder(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _currency,
            _createdDate
        );
    }

    function _cancelOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) internal virtual {
        uint totalAmount = 0;
        string seller;
        address[] assets;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            totalAmount += s.price();
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            try {
                s.unlockQuantity(_purchaser);
            } catch { // Support for legacy sales
                address(s).call("unlockQuantity");
            }
        }
        emit Order(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            _currency,
            PaymentStatus.ORDER_CANCELLED,
            _createdDate
        );
    }

    function _unitsPerDollar() internal virtual returns (uint) {
        return 1;
    }

    function update(
        string _imageURL
    ,   string _checkoutText
    ,   uint   _scheme
    ) requireOwner("update the payment service") public returns (uint) {
      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        imageURL = _imageURL;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        checkoutText = _checkoutText;
      }

      return RestStatus.OK;
    }
}