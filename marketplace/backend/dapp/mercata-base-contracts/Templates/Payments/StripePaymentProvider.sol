pragma es6;
pragma strict;

import <bbcd8ec0bf0cdf0c17b4123429893df42692052a>;

/// @title A representation of Carbon assets
contract StripePaymentProvider is PaymentProvider {
    constructor (
            string _name
        ,   string _accountId
        ,   uint _createdDate
    ) public PaymentProvider(_name, _accountId, _createdDate) {
    }
}