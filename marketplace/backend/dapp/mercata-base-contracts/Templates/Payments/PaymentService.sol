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
        address[] recipients;
        uint[] quantities;
    }
    mapping (string => Order) public record openOrders;

    event Payment(
        string purchasersCommonName,
        string sellersCommonName,
        uint amount,
        bool success
    );

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
    ) external returns (string) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        string token = keccak256(string(this), string(msg.sender), string(block.timestamp));
        return _createOrder(_saleAddresses, _quantities, token);
    }

    mapping (address => uint) quantitiesMap;
    function _createOrder (
        address[] _saleAddresses,
        uint[] _quantities,
        string token
    ) internal virtual returns (string) {
        openOrders[token].purchaser = msg.sender;
        return token;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            address recipient = a.owner();
            openOrders[token].saleAddresses.push(_saleAddresses[i]);
            if (quantitiesMap[recipient] == 0) {
                openOrders[token].recipients.push(recipient);
            }
            uint quantity = _quantities[i];
            uint amount = s.price();
            quantitiesMap[recipient] += amount;
            Sale(_saleAddresses[i]).lockQuantity(_quantities[i], msg.sender);
        }
        for (uint j = 0; j < openOrders[token].recipients.length; j++) {
            address recipient = openOrders[token].recipients[j];
            openOrders[token].quantities.push(quantitiesMap[recipient]);
            quantitiesMap[recipient] = 0;
        }
        return token;
    }

    function completeOrder (
        string _token
    ) requireOwner("complete order") external returns (address[]) {
        return _completeOrder(_token);
    }

    function _completeOrder (
        string token
    ) internal virtual returns (address[]) {
        require(openOrders[token].purchaser != address(0), "Invalid order token: " + token);
        address[] assets;
        for (uint i = 0; i < openOrders[token].saleAddresses.length; i++) {
            Sale s = Sale(openOrders[token].saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            s.completeSale(openOrders[token].purchaser);
            openOrders[token].saleAddresses[i] = address(0);
        }
        for (uint j = 0; j < openOrders[token].recipients.length; j++) {
            address recipient = openOrders[token].recipients[j];
            emit Payment(getCommonName(msg.sender), getCommonName(recipient), openOrders[token].quantities[j], true);
            openOrders[token].recipients[j] = address(0);
            openOrders[token].quantities[j] = 0;
        }
        openOrders[token].purchaser = address(0);
        return assets;
    }

    function cancelOrder (
        string _token
    ) requirePurchaserOrOwner(_token, "cancel order") external {
        return _cancelOrder(_token);
    }

    function _cancelOrder (
        string token
    ) internal virtual {
        require(openOrders[token].purchaser != address(0), "Invalid order token: " + token);
        for (uint i = 0; i < openOrders[token].saleAddresses.length; i++) {
            Sale s = Sale(openOrders[token].saleAddresses[i]);
            s.unlockQuantity(openOrders[token].purchaser);
            openOrders[token].saleAddresses[i] = address(0);
        }
        for (uint j = 0; j < openOrders[token].recipients.length; j++) {
            address recipient = openOrders[token].recipients[j];
            emit Payment(getCommonName(msg.sender), getCommonName(recipient), quantitiesMap[recipient], false);
            openOrders[token].recipients[j] = address(0);
            openOrders[token].quantities[j] = 0;
            quantitiesMap[recipient] = 0;
        }
        openOrders[token].purchaser = address(0);
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