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
        string[] sellers;
        mapping(string => OrderLine) orderLines;
    }

    struct OrderLine {
        address[] saleAddresses;
        uint[] quantities;
        uint total;
    }
    mapping (string => Order) public record openOrders;

    event Payment(
        string token,
        string purchasersCommonName,
        string sellersCommonName,
        address[] saleAddresses,
        uint[] quantities,
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
            string seller = getCommonName(a.owner());
            uint quantity = _quantities[i];
            openOrders[token].orderLines[seller].saleAddresses.push(_saleAddresses[i]);
            openOrders[token].orderLines[seller].quantities.push(quantity);
            uint amount = s.price();
            if (openOrders[token].orderLines[seller].total == 0) {
                openOrders[token].sellers.push(seller);
            }
            openOrders[token].orderLines[seller].total += amount;
            try {
                Sale(_saleAddresses[i]).lockQuantity(quantity, msg.sender);
            } catch { // Support for legacy sales
                _saleAddresses[i].call("lockQuantity", quantity);
            }
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
        for (uint i = 0; i < openOrders[token].sellers.length; i++) {
            string seller = openOrders[token].sellers[i];
            address[] saleAddresses;
            uint[] quantities;
            for (uint j = 0; j < openOrders[token].orderLines[seller].saleAddresses.length; j++) {
                address saleAddress = openOrders[token].orderLines[seller].saleAddresses[j];
                saleAddresses.push(saleAddress);
                quantities.push(openOrders[token].orderLines[seller].quantities[j]);
                Sale s = Sale(saleAddress);
                Asset a = s.assetToBeSold();
                assets.push(address(a));
                try {
                    s.completeSale(openOrders[token].purchaser);
                } catch { // Support for legacy sales
                    address(s).call("completeSale");
                }
                openOrders[token].orderLines[seller].saleAddresses[j] = address(0);
                openOrders[token].orderLines[seller].quantities[j] = 0;
            }
            emit Payment(
                token,
                getCommonName(openOrders[token].purchaser),
                seller,
                saleAddresses,
                quantities,
                openOrders[token].orderLines[seller].total,
                0,
                _unitsPerDollar(),
                true
            );
            openOrders[token].orderLines[seller].saleAddresses.length = 0;
            openOrders[token].orderLines[seller].quantities.length = 0;
            openOrders[token].orderLines[seller].total = 0;
            openOrders[token].sellers[i] = "";
        }
        openOrders[token].purchaser = address(0);
        openOrders[token].sellers.length = 0;
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
        for (uint i = 0; i < openOrders[token].sellers.length; i++) {
            string seller = openOrders[token].sellers[i];
            address[] saleAddresses;
            uint[] quantities;
            for (uint j = 0; j < openOrders[token].orderLines[seller].saleAddresses.length; j++) {
                address saleAddress = openOrders[token].orderLines[seller].saleAddresses[j];
                saleAddresses.push(saleAddress);
                quantities.push(openOrders[token].orderLines[seller].quantities[j]);
                Sale s = Sale(saleAddress);
                try {
                    s.unlockQuantity(openOrders[token].purchaser);
                } catch { // Support for legacy sales
                    address(s).call("unlockQuantity");
                }
                openOrders[token].orderLines[seller].saleAddresses[j] = address(0);
                openOrders[token].orderLines[seller].quantities[j] = 0;
            }
            emit Payment(
                token,
                getCommonName(openOrders[token].purchaser),
                seller,
                saleAddresses,
                quantities,
                openOrders[token].orderLines[seller].total,
                0,
                _unitsPerDollar(),
                false
            );
            openOrders[token].orderLines[seller].saleAddresses.length = 0;
            openOrders[token].orderLines[seller].quantities.length = 0;
            openOrders[token].orderLines[seller].total = 0;
            openOrders[token].sellers[i] = "";
        }
        openOrders[token].purchaser = address(0);
        openOrders[token].sellers.length = 0;
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