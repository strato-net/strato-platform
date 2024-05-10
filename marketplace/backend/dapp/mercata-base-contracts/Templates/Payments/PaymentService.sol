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

    struct Order {
        address purchaser;
        address[] saleAddresses;
        uint[] quantities;
        address[] recipients;
        uint[] totals;
    }
    mapping (string => Order) public record openOrders;

    event Payment(
        string token,
        string purchasersCommonName,
        string sellersCommonName,
        uint amount,
        uint tax,
        uint unitsPerDollar,
        bool success
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

    modifier requirePurchaserOrOwner(string token, string action) {
        string err = "Only the purchaser or owner can "
                   + action
                   + ".";
        string commonName = getCommonName(msg.sender);
        require(commonName == ownerCommonName || commonName == getCommonName(openOrders[token].purchaser), err);
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

    function createOrder (
        address[] _saleAddresses,
        uint[] _quantities
    ) requireActive("create order") external returns (string, address[]) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string token = keccak256(string(this), string(msg.sender), string(block.timestamp));
        return _createOrder(_saleAddresses, _quantities, token);
    }

    mapping (address => uint) totalsMap;
    function _createOrder (
        address[] _saleAddresses,
        uint[] _quantities,
        string token
    ) internal virtual returns (string, address[]) {
        openOrders[token].purchaser = msg.sender;
        address[] assets;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            address recipient = a.owner();
            openOrders[token].saleAddresses.push(_saleAddresses[i]);
            uint quantity = _quantities[i];
            openOrders[token].quantities.push(quantity);
            if (totalsMap[recipient] == 0) {
                openOrders[token].recipients.push(recipient);
            }
            uint amount = s.price();
            totalsMap[recipient] += amount;
            try {
                Sale(_saleAddresses[i]).lockQuantity(quantity, msg.sender);
            } catch { // Support for legacy sales
                _saleAddresses[i].call("lockQuantity", quantity);
            }
        }
        for (uint j = 0; j < openOrders[token].recipients.length; j++) {
            address recipient = openOrders[token].recipients[j];
            openOrders[token].totals.push(totalsMap[recipient]);
            totalsMap[recipient] = 0;
        }
        return (token, assets);
    }

    function completeOrder (
        string _token
    ) requireActive("complete order") requireOwner("complete order") external returns (address[]) {
        return _completeOrder(_token);
    }

    function _completeOrder (
        string token
    ) internal virtual returns (address[]) {
        require(openOrders[token].purchaser != address(0), "Invalid order token: " + token);
        purchasersAddress = openOrders[token].purchaser; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);
        address[] assets;
        for (uint i = 0; i < openOrders[token].saleAddresses.length; i++) {
            Sale s = Sale(openOrders[token].saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            try {
                s.completeSale(openOrders[token].purchaser);
            } catch { // Support for legacy sales
                address(s).call("completeSale");
            }
            openOrders[token].saleAddresses[i] = address(0);
            openOrders[token].quantities[i] = 0;
        }
        for (uint j = 0; j < openOrders[token].recipients.length; j++) {
            address recipient = openOrders[token].recipients[j];
            emit Payment(token, getCommonName(msg.sender), getCommonName(recipient), openOrders[token].totals[j], 0, _unitsPerDollar(), true);
            openOrders[token].recipients[j] = address(0);
            openOrders[token].totals[j] = 0;
        }
        openOrders[token].purchaser = address(0);
        purchasersAddress = address(0); // Support for legacy sales
        purchasersCommonName = "";
        return assets;
    }

    function cancelOrder (
        string _token
    ) requireActive("cancel order") requirePurchaserOrOwner(_token, "cancel order") external {
        return _cancelOrder(_token);
    }

    function _cancelOrder (
        string token
    ) internal virtual {
        require(openOrders[token].purchaser != address(0), "Invalid order token: " + token);
        for (uint i = 0; i < openOrders[token].saleAddresses.length; i++) {
            Sale s = Sale(openOrders[token].saleAddresses[i]);
            try {
                s.unlockQuantity(openOrders[token].purchaser);
            } catch { // Support for legacy sales
                address(s).call("unlockQuantity");
            }
            openOrders[token].saleAddresses[i] = address(0);
            openOrders[token].quantities[i] = 0;
        }
        for (uint j = 0; j < openOrders[token].recipients.length; j++) {
            address recipient = openOrders[token].recipients[j];
            emit Payment(token, getCommonName(msg.sender), getCommonName(recipient), totalsMap[recipient], 0, _unitsPerDollar(), false);
            openOrders[token].recipients[j] = address(0);
            openOrders[token].totals[j] = 0;
            totalsMap[recipient] = 0;
        }
        openOrders[token].purchaser = address(0);
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