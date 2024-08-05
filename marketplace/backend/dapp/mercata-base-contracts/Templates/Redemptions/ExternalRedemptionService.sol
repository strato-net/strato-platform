pragma es6;
pragma strict;

import <c338f43418d1d79cae95f23f5b62202eae3317d4>;

contract ExternalRedemptionService is RedemptionService {

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
    ) public RedemptionService(
        _serviceName,
        _imageURL,
        _redeemText,
        _serviceURL,
        _createRedemptionRoute,
        _outgoingRedemptionsRoute,
        _incomingRedemptionsRoute,
        _getRedemptionRoute,
        _closeRedemptionRoute,
        _createCustomerAddressRoute,
        _getCustomerAddressRoute
    ) {
    }
}