pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Carbon assets
contract ExternalPaymentService is PaymentService {
    constructor (
        string _serviceName,
        string _serviceURL,
        string _imageURL,
        string _onboardingText,
        string _checkoutText
    ) public PaymentService(_serviceName, _serviceURL, _imageURL, _onboardingText, _checkoutText) {
    }
}