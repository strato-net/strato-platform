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

    decimal public primarySaleFeePercentage;
    decimal public secondarySaleFeePercentage;

    event SellerOnboarded (
        string sellersCommonName,
        bool isActive
    );

    enum PaymentStatus { NULL, AWAITING_FULFILLMENT, PAYMENT_PENDING, CLOSED, CANCELED }

    event AssetLocked (
        string orderHash,             /* Unique hash of the order details for payment server lookup to
                                         avoid having to send all the order details in the request. */
        string orderId,               // Same orderId funtionality as the current marketplace
        address purchaser,            // Purchaser address on the blockchain for ownershipTransfer
        string purchasersCommonName,  // Purchaser common name for lookup purposes
        string sellersCommonName,     // Seller common name for lookup purposes
        address[] saleAddresses,      // List of the sale contracts for the assets in the order
        uint[] quantities,            // List of quantities for each asset being bought
        decimal amount,               // Total price of the order
        decimal tax,                  // Tax
        decimal fee,                  // Fee payment (in dollar value)
        decimal unitsPerDollar,       // Amount of units per dollar for the currency (Ex: STRAT is 100 units per dollar)
        string currency,              // The type of currency used for the purchase
        PaymentStatus status,         // Status of the payment
        uint createdDate,              // Date at the time of fresh order creation
        string comments               // Comments for the order
    );

    event Order (
        string orderHash,             /* Unique hash of the order details for payment server lookup to 
                                         avoid having to send all the order details in the request. */
        string orderId,               // Same orderId funtionality as the current marketplace
        address purchaser,            // Purchaser address on the blockchain for ownershipTransfer
        string purchasersCommonName,  // Purchaser common name for lookup purposes
        string sellersCommonName,     // Seller common name for lookup purposes
        address[] saleAddresses,      // List of the sale contracts for the assets in the order
        uint[] quantities,            // List of quantities for each asset being bought
        decimal amount,               // Total price of the order
        decimal tax,                  // Tax
        decimal fee,                  // Fee payment (in dollar value)
        decimal unitsPerDollar,       // Amount of units per dollar for the currency (Ex: STRAT is 100 units per dollar)
        string currency,              // The type of currency used for the purchase
        PaymentStatus status,         // Status of the payment
        uint createdDate,              // Date at the time of fresh order creation
        string comments               // Comments for the order
    );

    address public purchasersAddress;   // ONLY USED FOR BACKWARDS COMPATIBILITY WITH SALE. DELETE ONCE ALL SALES USE NEW LOGIC!!!
    string public purchasersCommonName; // ONLY USED FOR BACKWARDS COMPATIBILITY WITH SALE. DELETE ONCE ALL SALES USE NEW LOGIC!!!

    constructor (
        string _serviceName,
        string _imageURL,
        string _checkoutText,
        decimal _primarySaleFeePercentage,
        decimal _secondaySaleFeePercentage
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

        primarySaleFeePercentage = _primarySaleFeePercentage;
        secondarySaleFeePercentage = _secondaySaleFeePercentage;
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

    function updateFees(
        decimal _primarySaleFeePercentage,
        decimal _secondaySaleFeePercentage
    ) requireOwner("update fee percentages") external {
        primarySaleFeePercentage = _primarySaleFeePercentage;
        secondarySaleFeePercentage = _secondaySaleFeePercentage;
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
        uint _createdDate,
        string _comments
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
            _createdDate,
            _comments
        );
    }

    function _createOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        uint _createdDate,
        string _comments
    ) internal virtual returns (string, address[]) {
        address[] assets;
        decimal totalAmount = 0;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            uint quantity = _quantities[i];
            totalAmount += s.price() * decimal(quantity);
            seller = getCommonName(a.owner());
            try {
                s.lockQuantity(quantity, _orderHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    _saleAddresses[i].call("lockQuantity", quantity, _purchaser);
                } catch {
                    _saleAddresses[i].call("lockQuantity", quantity);
                }
            }
        }
        emit AssetLocked(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            0,
            _unitsPerDollar(),
            "",
            PaymentStatus.AWAITING_FULFILLMENT,
            _createdDate,
            ""
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
        uint _createdDate,
        string _comments
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
            _createdDate,
            _comments
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
        uint _createdDate,
        string _comments
    ) internal virtual returns (address[]){
        decimal totalAmount = 0;
        address[] assets;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            totalAmount += s.price() * decimal(_quantities[i]);
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
            0,
            _unitsPerDollar(),
            _currency,
            PaymentStatus.PAYMENT_PENDING,
            _createdDate,
            ""
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
        uint _createdDate,
        string _comments
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
            _createdDate,
            _comments
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
        uint _createdDate,
        string _comments
    ) internal virtual returns (address[]) {
        decimal totalAmount = 0;
        address[] assets;
        string seller;
        decimal totalFee = 0.0;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            decimal saleAmount = s.price() * _quantities[i];
            totalAmount += saleAmount;
            if (address(a) == address(a.root)) {
                totalFee += (saleAmount * primarySaleFeePercentage) / 100;
            } else {
                totalFee += (saleAmount * secondarySaleFeePercentage) / 100;
            }
            try {
                s.completeSale(_orderHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    address(s).call("completeSale", _purchaser);
                } catch {
                    address(s).call("completeSale");
                }
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
            totalFee,
            _unitsPerDollar(),
            _currency,
            PaymentStatus.CLOSED,
            _createdDate,
            _comments
        );
        return assets;
    }

    function discardOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate,
        string _comments
    ) requireActive("discard order") external {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string orderHash = getOrderHash(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(orderHash == _orderHash, "Invalid order data to discard");
        string err = "Only the purchaser or owner can dicard the order.";
        string commonName = getCommonName(msg.sender);
        require(commonName == ownerCommonName, err);
        return _discardOrder(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _currency,
            _createdDate,
            _comments
        );
    }
    
    function _discardOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate,
        string _comments
    ) internal virtual {
        decimal totalAmount = 0;
        string seller;
        address[] assets;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            totalAmount += s.price() * _quantities[i];
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            try {
                s.unlockQuantity(_orderHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    address(a).call("unlockQuantity", _purchaser);
                } catch {
                    address(s).call("unlockQuantity");
                }
            }
        }
        emit AssetLocked(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            0,
            _unitsPerDollar(),
            "",
            PaymentStatus.CANCELED,
            _createdDate,
            "Order has been discarded"
        );
    }

    function cancelOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate,
        string _comments
    ) requireActive("cancel order") external {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string orderHash = getOrderHash(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(orderHash == _orderHash, "Invalid order data");
        string err = "Only the purchaser or owner can cancel the order.";
        string commonName = getCommonName(msg.sender);
        require(commonName == ownerCommonName, err);
        return _cancelOrder(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _currency,
            _createdDate,
            _comments
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
        uint _createdDate,
        string _comments
    ) internal virtual {
        decimal totalAmount = 0;
        string seller;
        address[] assets;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            totalAmount += s.price() * _quantities[i];
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            try {
                s.unlockQuantity(_orderHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    address(s).call("unlockQuantity", _purchaser);
                } catch {
                    address(s).call("unlockQuantity");
                }
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
            0,
            _unitsPerDollar(),
            _currency,
            PaymentStatus.CANCELED,
            _createdDate,
            _comments
        );
    }

    function _unitsPerDollar() internal virtual returns (decimal) {
        return 1.0;
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
