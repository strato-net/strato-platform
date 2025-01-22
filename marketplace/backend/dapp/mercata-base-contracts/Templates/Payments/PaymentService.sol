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
        bool isActive,
        string ownerCommonName,
        string serviceName
    );

    enum PaymentStatus { NULL, AWAITING_FULFILLMENT, PAYMENT_PENDING, CLOSED, CANCELED }

    event Checkout (
        string checkoutHash,                /* Unique hash of the order details for payment server lookup to
                                               avoid having to send all the order details in the request. */
        string checkoutId,                  // checkoutId 
        address purchaser,                  // Purchaser address on the blockchain for ownershipTransfer
        string purchasersCommonName,        // Purchaser common name for lookup purposes
        address[] saleAddresses,            // List of the sale contracts for the assets in the checkout
        uint[] quantitiesToBePurchased,     // List of quantities for each asset being bought
        decimal amount                      // Total price of the checkout
    );

    event Order (
        string orderHash,             /* Unique hash of the order details for payment server lookup to 
                                         avoid having to send all the order details in the request. */
        string orderId,               // Same orderId funtionality as the current marketplace
        address purchaser,            // Purchaser address on the blockchain for ownershipTransfer
        string purchasersCommonName,  // Purchaser common name for lookup purposes
        string sellersCommonName,     // Seller common name for lookup purposes
        address sellerAddress,        // Seller address on the blockchain for ownershipTransfer. Asset Owner
        address[] saleAddresses,      // List of the sale contracts for the assets in the order
        uint[] quantities,            // List of quantities for each asset being bought
        decimal amount,               // Total price of the order
        decimal tax,                  // Tax
        decimal fee,                  // Fee payment (in dollar value)
        decimal unitsPerDollar,       // Amount of units per dollar for the currency (Ex: USDST is 1e18 units per dollar)
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
        decimal _secondarySaleFeePercentage
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
        secondarySaleFeePercentage = _secondarySaleFeePercentage;
    }

    modifier requireOwner(string action) {
        string err = "Only the owner can "
                   + action
                   + ".";
        require(msg.sender == owner || getCommonName(msg.sender) == ownerCommonName, err);
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
        decimal _secondarySaleFeePercentage
    ) requireOwner("update fee percentages") external {
        primarySaleFeePercentage = _primarySaleFeePercentage;
        secondarySaleFeePercentage = _secondarySaleFeePercentage;
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
        emit SellerOnboarded(_sellersCommonName, _isActive, ownerCommonName, serviceName);
        return RestStatus.OK;
    }

    function offboardSeller(
        string _sellersCommonName
    ) requireOwner("offboard sellers") public returns (uint) {
        emit SellerOnboarded(_sellersCommonName, false, ownerCommonName, serviceName);
        return RestStatus.OK;
    }

    function checkoutInitialized (
        address[] _tokenAssetAddresses,
        string _checkoutId,
        address[] _saleAddresses,
        uint[] _quantities,
        uint _createdDate,
        string _comments
    ) requireActive("create ckeckout") external returns (string, address[]) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(msg.sender);
        string checkoutHash = getOrderHash(_checkoutId, _purchasersCommonName, _saleAddresses, _quantities);
        return _checkoutInitialized(
            _tokenAssetAddresses,
            checkoutHash,
            _checkoutId,
            msg.sender,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _createdDate,
            _comments
        );
    }

    function _checkoutInitialized (
        address[] _tokenAssetAddresses,
        string _checkoutHash,
        string _checkoutId,
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
                s.lockQuantity(quantity, _checkoutHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    _saleAddresses[i].call("lockQuantity", quantity, _purchaser);
                } catch {
                    _saleAddresses[i].call("lockQuantity", quantity);
                }
            }
        }
        emit Checkout (
            _checkoutHash,              
            _checkoutId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            totalAmount
        );
        return (_checkoutHash, assets);
    }

    function generateIntermediateOrder (
        string _checkoutHash,
        string _checkoutId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate,
        string _comments
    ) requireActive("generate intermediate order") requireOwner("generate intermediate order") external returns (address[]){
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string orderHash = getOrderHash(_checkoutId, _purchasersCommonName, _saleAddresses, _quantities);
        require(orderHash == _checkoutHash, "Invalid checkout data to create order");
        return _generateIntermediateOrder(
            _checkoutHash,
            _checkoutId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities,
            _currency,
            _createdDate,
            _comments
        );
    }

    function _generateIntermediateOrder (
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
        string sellerCommonName;
        address sellerAddress;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            sellerCommonName = getCommonName(a.owner());
            sellerAddress = a.owner();
            totalAmount += s.price() * decimal(_quantities[i]);
        }
        emit Order(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            sellerCommonName,
            sellerAddress,
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
        string sellerCommonName;
        address sellerAddress;
        decimal totalFee = 0.0;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            sellerCommonName = getCommonName(a.owner());
            sellerAddress = a.owner();
            decimal saleAmount = s.price() * _quantities[i];
            totalAmount += saleAmount;
            if (address(a) == address(a.root)) {
                totalFee += (saleAmount * primarySaleFeePercentage);
            } else {
                totalFee += (saleAmount * secondarySaleFeePercentage);
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
            sellerCommonName,
            sellerAddress,
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

    function discardCheckoutQuantity (
        string _checkoutHash,
        string _checkoutId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities
    ) requireActive("discard checkout") external {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string orderHash = getOrderHash(_checkoutId, _purchasersCommonName, _saleAddresses, _quantities);
        require(orderHash == _checkoutHash, "Invalid checkout data to discard");
        string err = "Only the owner can dicard the checkout data.";
        string commonName = getCommonName(msg.sender);
        require(commonName == ownerCommonName, err);
        return _discardCheckoutQuantity(
            _checkoutHash,
            _purchaser,
            _saleAddresses,
            _quantities
        );
    }
    
    function _discardCheckoutQuantity (
        string _checkoutHash,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities
    ) internal virtual {
        decimal totalAmount = 0;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            totalAmount += s.price() * _quantities[i];
            Asset a = s.assetToBeSold();
            try {
                s.unlockQuantity(_checkoutHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    address(a).call("unlockQuantity", _purchaser);
                } catch {
                    address(s).call("unlockQuantity");
                }
            }
        }
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
        string err = "Only the owner can cancel the order.";
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
        string sellerCommonName;
        address sellerAddress;
        address[] assets;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            totalAmount += s.price() * _quantities[i];
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            sellerCommonName = getCommonName(a.owner());
            sellerAddress = a.owner();
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
            sellerCommonName,
            sellerAddress,
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
