pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract StratPaymentService is PaymentService {
    address public stratAddress;
    uint public stratsPerDollar;

    constructor (
        address _stratAddress,
        uint _stratsPerDollar,
        string _imageURL
    ) PaymentService("STRAT", _imageURL, "Checkout with STRAT") public {
        stratAddress = _stratAddress;
        stratsPerDollar = _stratsPerDollar;
    }

    function _createOrder (
        address[] _saleAddresses,
        uint[] _quantities,
        string token
    ) internal override returns (string) {
        require(_saleAddresses.length == _quantities.length, "Number of sale addresses does not match number of quantities given");
        address[] stratRecipients;
        uint totalAmount;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            address recipient = a.owner();
            if (quantitiesMap[recipient] == 0) {
                stratRecipients.push(recipient);
            }
            uint quantity = _quantities[i];
            uint amount = s.price() * quantity * stratsPerDollar * 100; // 1 STRAT = 1 STRAT cents
            totalAmount += amount;
            quantitiesMap[recipient] += amount;
            try {
                s.lockQuantity(quantity, tx.origin);
            } catch { // Support for legacy sales
                address(s).call("lockQuantity", quantity);
            }
            purchasersAddress = tx.origin; // Support for legacy sales
            purchasersCommonName = getCommonName(tx.origin);
            try {
                s.completeSale(tx.origin);
            } catch { // Support for legacy sales
                address(s).call("completeSale");
            }
            purchasersAddress = address(0); // Support for legacy sales
            purchasersCommonName = "";
        }
        string err = "Your STRAT account balance is not high enough to cover the purchase.";
        uint myBalance = stratAddress.call("balance");
        require(myBalance >= totalAmount, err);
        for (uint j = 0; j < stratRecipients.length; j++) {
            address recipient = stratRecipients[j];
            bool success = stratAddress.call("transfer", recipient, quantitiesMap[recipient]);
            emit Payment(getCommonName(tx.origin), getCommonName(recipient), quantitiesMap[recipient]);
            quantitiesMap[recipient] = 0;
            require(success, err);
        }

        return token;
    }

    function _completeOrder (
        string token
    ) internal override returns (address[]) {
        require(false, "Cannot call completeSales for STRAT payments.");
    }

    function updateStratsPerDollar(uint _stratsPerDollar) requireOwner() public returns (uint) {
      stratsPerDollar = _stratsPerDollar;
      return RestStatus.OK;
    }
}