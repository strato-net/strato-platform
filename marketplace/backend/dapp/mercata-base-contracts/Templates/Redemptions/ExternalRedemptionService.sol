pragma es6;
pragma strict;

import <db8c36e0e8c136afc1d3e4417dc1940f952aafd7>;

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