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

    string public serviceName;
    string public imageURL;
    string public onboardingText;
    string public checkoutText;

    // There are multiple alternatives
    string public serviceURL; // Provide server base URL, have app append routes
    ////
    //// Provide server base URL, allow custom onboarding and payment routes
    // string public serviceURL;
    // string public onboardingRoute;
    // string public checkoutRoute;
    ////
    //// Provide entire URLs for onboarding and checkout, no app-side manipulation required
    // string public onboardingURL;
    // string public checkoutURL;

    event Payment(
        string purchasersCommonName,
        string sellersCommonName,
        string amount
    );

    constructor (
        string _serviceName,
        string _serviceURL,
        string _imageURL,
        string _onboardingText,
        string _checkoutText
    ) public {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        serviceName = _serviceName;
        serviceURL = _serviceURL;
        imageURL = _imageURL;
        if (_onboardingText != "") {
            onboardingText = _onboardingText;
            checkoutText = _checkoutText;
        } else {
            onboardingText = "Connect " + serviceName;
        }
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

    function lockSales (
        address[] _saleAddresses,
        uint[] _quantities
    ) external returns (uint) {
        return _lockSales(_saleAddresses, _quantities);
    }

    function _lockSales (
        address[] _saleAddresses,
        uint[] _quantities
    ) internal virtual returns (uint) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale(_saleAddresses[i]).lockQuantity(_quantities[i], msg.sender);
        }
        return RestStatus.OK;
    }

    function completeSales (
        address[] _saleAddresses,
        address _purchaser
    ) requireOwner("complete sales") external returns (uint) {
        return _completeSales(_saleAddresses, _purchaser);
    }

    function _completeSales (
        address[] _saleAddresses,
        address _purchaser
    ) internal virtual returns (uint) {
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale(_saleAddresses[i]).completeSale(_purchaser);
        }
        // emit Payment(getCommonName(_purchaser), _amount);
        return RestStatus.OK;
    }

    function update(
        string _serviceURL
    ,   string _imageURL
    ,   string _onboardingText
    ,   string _checkoutText
    ,   uint   _scheme
    ) external returns (uint) {
        return _update(_serviceURL, _imageURL, _onboardingText, _checkoutText, _scheme);
    }

    function _update(
        string _serviceURL
    ,   string _imageURL
    ,   string _onboardingText
    ,   string _checkoutText
    ,   uint   _scheme
    ) internal virtual returns (uint) {
      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        serviceURL = _serviceURL;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        imageURL = _imageURL;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        onboardingText = _onboardingText;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        checkoutText = _checkoutText;
      }

      return RestStatus.OK;
    }
}