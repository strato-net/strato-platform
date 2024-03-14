pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

abstract contract Payment {
    address public paymentServiceProvider;
    address public saleAddress;

    event PaymentProcessed(address assetAddress, address payer, uint amount, uint date);

    constructor(address _assetAddress, address _provider, address _sale) {
        paymentServiceProvider = _provider;
        saleAddress = _sale;
    }

    // Abstract transfer function to be implemented in derived contracts
    function transfer(address _to) public virtual;

    // Utility function to emit the payment processed event
    function _processPayment(address _payer, uint _amount) internal {
        emit PaymentProcessed(address(sale.assetToBeSold), _payer, _amount, block.timestamp);
    }
}