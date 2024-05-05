pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract StratPaymentService is PaymentService {
    address public stratAddress;

    constructor (
        address _stratAddress,
        string _imageURL
    ) public {
        stratAddress = _stratAddress;
        serviceName = "STRAT";
        serviceURL = "";
        imageURL = _imageURL;
        onboardingText = "";
        checkoutText = "Checkout with " + serviceName;
    }

    mapping (address => uint) stratQuantities;
    function _lockSales (
        address[] _saleAddresses,
        uint[] _quantities
    ) internal override returns (uint) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        address[] stratRecipients;
        uint totalAmount;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            address recipient = a.owner();
            if (stratQuantities[recipient] == 0) {
                stratRecipients.push(recipient);
            }
            uint quantity = _quantities[i];
            uint amount = s.price() * quantity * 100; // 1 STRAT currently equals 1 cent
            totalAmount += amount;
            stratQuantities[recipient] += amount;
            s.lockQuantity(quantity, tx.origin); // The STRAT contract uses tx.origin for transfers, so it would be
            s.completeSale(tx.origin);           // a security hole for us to use msg.sender here
        }
        string err = "Your STRAT account balance is not high enough to cover the purchase.";
        uint myBalance = stratAddress.call("balance");
        require(myBalance >= totalAmount, err);
        for (uint j = 0; j < stratRecipients.length; j++) {
            address recipient = stratRecipients[j];
            bool success = stratAddress.call("transfer", recipient, stratQuantities[recipient]);
            emit Payment(getCommonName(tx.origin), getCommonName(recipient), stratQuantities[recipient]);
            stratQuantities[recipient] = 0;
            require(success, err);
        }

        return RestStatus.OK;
    }

    function _completeSales (
        address[] _saleAddresses,
        address _purchaser
    ) internal override returns (uint) {
        require(false, "Cannot call completeSales for STRAT payments.");
    }

    function _update(
        string _serviceURL
    ,   string _imageURL
    ,   string _onboardingText
    ,   string _checkoutText
    ,   uint   _scheme
    ) internal override returns (uint) {

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        return RestStatus.CONFLICT;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        return RestStatus.CONFLICT;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        return RestStatus.CONFLICT;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        imageURL = _imageURL;
      }

      return RestStatus.OK;
    }
}