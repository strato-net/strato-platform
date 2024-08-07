pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

/// @title A representation of PaymentProvider_1 assets
abstract contract RedemptionService is Utils {
    address public owner;
    string public ownerCommonName;

    bool public isActive;

    string public serviceName;
    string public imageURL;
    string public redeemText;

    string public serviceURL;
    string public createRedemptionRoute;
    string public outgoingRedemptionsRoute;
    string public incomingRedemptionsRoute;
    string public getRedemptionRoute;
    string public closeRedemptionRoute;
    string public createCustomerAddressRoute;
    string public getCustomerAddressRoute;

    event Redemption (
        string redemptionId,
        Asset asset,
        string issuer,
        string owner,
        uint quantity
    );

    constructor (
        string _serviceName,
        string _imageURL,
        string _redeemText,
        string _serviceURL,
        string _createRedemptionRoute,
        string _outgoingRedemptionsRoute,
        string _incomingRedemptionsRoute,
        string _getRedemptionRoute,
        string _closeRedemptionRoute,
        string _createCustomerAddressRoute,
        string _getCustomerAddressRoute
    ) public {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        isActive = true;

        serviceName = _serviceName;
        imageURL = _imageURL;
        if (_redeemText != "") {
            redeemText = _redeemText;
        } else {
            redeemText = "Redeem";
        }

        serviceURL = _serviceURL;
        createRedemptionRoute = _createRedemptionRoute;
        outgoingRedemptionsRoute = _outgoingRedemptionsRoute;
        incomingRedemptionsRoute = _incomingRedemptionsRoute;
        getRedemptionRoute = _getRedemptionRoute;
        closeRedemptionRoute = _closeRedemptionRoute;
        createCustomerAddressRoute = _createCustomerAddressRoute;
        getCustomerAddressRoute = _getCustomerAddressRoute;
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

    function deactivate() requireOwner("deactivate the redemption service") external {
        isActive = false;
    }

    function redemptionRequested (
        string _redemptionId
    ) public {
        Asset asset = Asset(msg.sender);
        emit Redemption (
            _redemptionId,
            Asset(msg.sender),
            msg.sender.creator,
            asset.ownerCommonName(),
            asset.quantity()
        );
    }

    function update(
        string _imageURL
    ,   string _redeemText
    ,   string _serviceURL
    ,   string _createRedemptionRoute
    ,   string _outgoingRedemptionsRoute
    ,   string _incomingRedemptionsRoute
    ,   string _getRedemptionRoute
    ,   string _closeRedemptionRoute
    ,   string _createCustomerAddressRoute
    ,   string _getCustomerAddressRoute
    ,   uint   _scheme
    ) requireOwner("update the redemption service") public returns (uint) {
      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        imageURL = _imageURL;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        redeemText = _redeemText;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        serviceURL = _serviceURL;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        createRedemptionRoute = _createRedemptionRoute;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        outgoingRedemptionsRoute = _outgoingRedemptionsRoute;
      }
      if ((_scheme & (1 << 5)) == (1 << 5)) {
        incomingRedemptionsRoute = _incomingRedemptionsRoute;
      }
      if ((_scheme & (1 << 6)) == (1 << 6)) {
        getRedemptionRoute = _getRedemptionRoute;
      }
      if ((_scheme & (1 << 7)) == (1 << 7)) {
        closeRedemptionRoute = _closeRedemptionRoute;
      }
      if ((_scheme & (1 << 8)) == (1 << 8)) {
        createCustomerAddressRoute = _createCustomerAddressRoute;
      }
      if ((_scheme & (1 << 9)) == (1 << 9)) {
        getCustomerAddressRoute = _getCustomerAddressRoute;
      }

      return RestStatus.OK;
    }
}