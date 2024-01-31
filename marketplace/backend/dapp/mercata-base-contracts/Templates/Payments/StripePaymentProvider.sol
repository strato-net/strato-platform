pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Carbon assets
contract StripePaymentProvider is BasePaymentProvider {
    /* struct StripePaymentInfo {
        address[] saleAddresses;
        string paymentStatus;
        string sessionStatus;
        string amount;
        uint paymentCreatedDate;
        uint expiresAt;
    } */

    // These mappings are hacks because SolidVM doesn't like mappings of structs
    mapping (string => address[]) saleAddresses;
    mapping (string => string) paymentStatus;
    mapping (string => string) sessionStatus;
    mapping (string => string) amount;
    mapping (string => uint) paymentCreatedDate;
    mapping (string => uint) expiresAt;

    // "id": "cs_test_a1jIRGPJra3H8e001xRh73mOu7XwppoKEVxcrgB8fijVuP5lAi2e1pHuMr",
    //"payment_intent": "pi_1Dt0s32eZvKYlo2CV1tCo99t",  ==>update
    event StripePaymentInitialized (
        string sellerAccountId,
        string paymentSessionId,
        string paymentStatus,
        string sessionStatus,
        string amount,
        uint createdDate,
        uint expiresAt
    );

    event StripePaymentFinalized (
        string sellerAccountId,
        string paymentSessionId,
        string paymentIntentId,
        string paymentStatus,
        string sessionStatus,
        string amount,
        uint createdDate,
        uint expiresAt
    );

    constructor (
            string _name
        ,   string _accountId
        ,   uint _createdDate
    ) public BasePaymentProvider(_name, _accountId, _createdDate) {
    }

    function initializePayment (
        address[] _saleAddresses,
        string _paymentSessionId,
        string _paymentStatus,
        string _sessionStatus,
        string _amount,
        uint _createdDate,
        uint _expiresAt
    ) external returns (uint) {
        require(saleAddresses[_paymentSessionId].length == 0, "Payment has already been created for this session ID");
        saleAddresses[_paymentSessionId] = _saleAddresses;
        paymentStatus[_paymentSessionId] = _paymentStatus;
        sessionStatus[_paymentSessionId] = _sessionStatus;
        amount[_paymentSessionId] = _amount;
        paymentCreatedDate[_paymentSessionId] = _createdDate;
        expiresAt[_paymentSessionId] = _expiresAt;
        emit StripePaymentInitialized(
            accountId,
            _paymentSessionId,
            _paymentStatus,
            _sessionStatus,
            _amount,
            _createdDate,
            _expiresAt
        );
        return RestStatus.OK;
    }

    function finalizePayment (
        string _paymentSessionId,
        string _paymentStatus,
        string _sessionStatus,
        string _paymentIntentId
    ) external returns (uint) {
        require(saleAddresses[_paymentSessionId].length > 0, "Payment has not been created for this session ID");
        emit Payment(
            accountId,
            amount[_paymentSessionId]
        );
        emit StripePaymentFinalized(
            accountId,
            _paymentSessionId,
            _paymentIntentId,
            _paymentStatus,
            _sessionStatus,
            amount[_paymentSessionId],
            paymentCreatedDate[_paymentSessionId],
            expiresAt[_paymentSessionId]
        );
        saleAddresses[_paymentSessionId] = [];
        paymentStatus[_paymentSessionId] = "";
        sessionStatus[_paymentSessionId] = "";
        amount[_paymentSessionId] = "";
        paymentCreatedDate[_paymentSessionId] = 0;
        expiresAt[_paymentSessionId] = 0;
        return RestStatus.OK;
    }
}