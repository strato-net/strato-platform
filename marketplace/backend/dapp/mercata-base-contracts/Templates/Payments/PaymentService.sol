pragma es6;
pragma strict;

import <509>;
import "../Sales/Sale.sol";
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

/// @title A representation of PaymentProvider_1 assets
abstract contract PaymentService is Utils {
    address public owner;
    string public ownerCommonName;

    bool public isActive;

    string public serviceName;
    string public imageURL;
    string public checkoutText;

    enum PaymentStatus { NULL, ORDER_CREATED, PAYMENT_INITIALIZED, ORDER_COMPLETED, ORDER_CANCELLED }

    event Payment (
        string token,
        string orderId,
        address purchaser,
        string purchasersCommonName,
        string sellersCommonName,
        address[] saleAddresses,
        uint[] quantities,
        uint amount,
        uint tax,
        uint unitsPerDollar,
        PaymentStatus status
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

    function getToken (
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
        string token = keccak256(
            string(this),
            _purchasersCommonName,
            _orderId,
            salesString,
            quantitiesString
        );
        return token;
    }

    function createOrder (
        string _orderId,
        address[] _saleAddresses,
        uint[] _quantities
    ) requireActive("create order") external returns (string, address[]) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(msg.sender);
        string token = getToken(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        return _createOrder(
            token,
            _orderId,
            msg.sender,
            _purchasersCommonName,
            _saleAddresses,
            _quantities
        );
    }

    function _createOrder (
        string token,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities
    ) internal virtual returns (string, address[]) {
        address[] assets;
        uint totalAmount = 0;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            uint amount = s.price();
            totalAmount += amount;
            seller = getCommonName(a.owner());
            uint quantity = _quantities[i];
            try {
                s.lockQuantity(quantity, _purchaser);
            } catch { // Support for legacy sales
                _saleAddresses[i].call("lockQuantity", quantity);
            }
        }
        emit Payment(
            token,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            PaymentStatus.ORDER_CREATED
        );
        return (token, assets);
    }

    function initializePayment (
        string _token,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities
    ) requireActive("initialize payment") requireOwner("initialize payment") external returns (address[]) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string token = getToken(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(token == _token, "Invalid order data");
        return _initializePayment(
            _token,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities
        );
    }

    function _initializePayment (
        string token,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities
    ) internal virtual returns (address[]) {
        uint totalAmount = 0;
        address[] assets;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            totalAmount += s.price();
        }
        emit Payment(
            token,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            PaymentStatus.PAYMENT_INITIALIZED
        );
        return assets;
    }

    function completeOrder (
        string _token,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        address[][] _utxoAddresses, //query cirrus to get all utxos with the same owner and originAddress. originAddress will be stored as root in cirrrus.
        uint[] _quantities
    ) requireActive("complete order") requireOwner("complete order") external returns (address[]) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string token = getToken(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(token == _token, "Invalid order data");
        return _completeOrder(
            _token,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _utxoAddresses,
            _quantities
        );
    }

    function _completeOrder (
        string token,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        address[][] _utxoAddresses,
        uint[] _quantities
    ) internal virtual returns (address[]) {
        uint totalAmount = 0;
        address[] assets;
        string seller;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
            totalAmount += s.price();
            try {
                s.completeSale(_purchaser, _utxoAddresses[i]);
            } catch { // Support for legacy sales
                address(s).call("unlockQuantity");
            }
        }
        emit Payment(
            token,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            PaymentStatus.ORDER_COMPLETED
        );
        return assets;
    }

    function cancelOrder (
        string _token,
        string _orderId,
        address _purchaser,
        address[] _saleAddresses,
        uint[] _quantities
    ) requireActive("cancel order") external {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string _purchasersCommonName = getCommonName(_purchaser);
        string token = getToken(_orderId, _purchasersCommonName, _saleAddresses, _quantities);
        require(token == _token, "Invalid order data");
        string err = "Only the purchaser or owner can cancel the order.";
        string commonName = getCommonName(msg.sender);
        require(commonName == ownerCommonName || commonName == _purchasersCommonName, err);
        return _cancelOrder(
            _token,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            _saleAddresses,
            _quantities
        );
    }

    function _cancelOrder (
        string token,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities
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
        emit Payment(
            token,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            PaymentStatus.ORDER_CANCELLED
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