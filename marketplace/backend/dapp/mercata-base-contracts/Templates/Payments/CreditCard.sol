pragma es6;
pragma strict;

import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

import <BASE_CODE_COLECTION>;

contract CreditCard is Payment {
    constructor(address _assetAddress, address _provider, address _sale) 
        Payment(_assetAddress, _provider, _sale) {
    }

    function transfer(address _to) public override {
        require(msg.sender == paymentServiceProvider, "Unauthorized");
        _processPayment(_to, _amount);
        Sale(sale).completeSale(_to);
    }
}