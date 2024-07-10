pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract ExternalPaymentService is PaymentService {

    // There are multiple alternatives
    // string public serviceURL; // Provide server base URL, have app append routes
    ////
    //// Provide server base URL, allow custom onboarding and payment routes
    string public serviceURL;
    string public onboardingRoute;
    string public onboardingStatusRoute;
    string public checkoutRoute;
    string public orderStatusRoute;
    ////
    //// Provide entire URLs for onboarding and checkout, no app-side manipulation required
    // string public onboardingURL;
    // string public onboardingStatusURL;
    // string public checkoutURL;

    string public onboardingText;

    constructor (
        string _serviceName,
        string _serviceURL,
        string _onboardingRoute,
        string _onboardingStatusRoute,
        string _checkoutRoute,
        string _orderStatusRoute,
        string _imageURL,
        string _onboardingText,
        string _checkoutText,
        decimal _primarySaleFeePercentage,
        decimal _secondaySaleFeePercentage
    ) public PaymentService(
        _serviceName,
        _imageURL,
        _checkoutText,
        _primarySaleFeePercentage,
        _secondaySaleFeePercentage
    ) {
        serviceURL = _serviceURL;
        onboardingRoute = _onboardingRoute;
        onboardingStatusRoute = _onboardingStatusRoute;
        checkoutRoute = _checkoutRoute;
        orderStatusRoute = _orderStatusRoute;
        if (_onboardingText != "") {
            onboardingText = _onboardingText;
        } else {
            onboardingText = "Connect to " + serviceName;
        }
    }

    function updateServerInfo(
        string _serviceURL
    ,   string _onboardingRoute
    ,   string _onboardingStatusRoute
    ,   string _checkoutRoute
    ,   string _orderStatusRoute
    ,   string _onboardingText
    ,   uint   _scheme
    ) requireOwner("update the payment server information") public returns (uint) {
      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        serviceURL = _serviceURL;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        onboardingRoute = _onboardingRoute;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        onboardingStatusRoute = _onboardingStatusRoute;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        checkoutRoute = _checkoutRoute;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        orderStatusRoute = _orderStatusRoute;
      }
      if ((_scheme & (1 << 5)) == (1 << 5)) {
        onboardingText = _onboardingText;
      }

      return RestStatus.OK;
    }
}