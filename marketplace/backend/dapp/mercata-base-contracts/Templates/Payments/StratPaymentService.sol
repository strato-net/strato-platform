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
    ) internal override returns (string, address[]) {
        address[] assets;
        address[] sellerAddresses;
        uint totalAmount;
        openOrders[token].purchaser = msg.sender;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            string seller = getCommonName(a.owner());
            uint quantity = _quantities[i];
            openOrders[token].orderLines[seller].saleAddresses.push(_saleAddresses[i]);
            openOrders[token].orderLines[seller].quantities.push(quantity);
            uint amount = s.price() * quantity * stratsPerDollar * 100;
            if (openOrders[token].orderLines[seller].total == 0) {
                openOrders[token].sellers.push(seller);
                sellerAddresses.push(a.owner());
            }
            openOrders[token].orderLines[seller].total += amount;
            totalAmount += amount;
            try {
                s.lockQuantity(quantity, msg.sender);
            } catch { // Support for legacy sales
                address(s).call("lockQuantity", quantity);
            }
        }
        string err = "Your STRAT account balance is not high enough to cover the purchase.";
        uint myBalance = stratAddress.call("balance");
        require(myBalance >= totalAmount, err);
        purchasersAddress = msg.sender; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);
        for (uint j = 0; j < openOrders[token].sellers.length; j++) {
            string seller = openOrders[token].sellers[j];
            address[] saleAddresses;
            uint[] quantities;
            for (uint k = 0; k < openOrders[token].orderLines[seller].saleAddresses.length; k++) {
                address saleAddress = openOrders[token].orderLines[seller].saleAddresses[k];
                saleAddresses.push(saleAddress);
                quantities.push(openOrders[token].orderLines[seller].quantities[k]);
                Sale s = Sale(saleAddress);
                Asset a = s.assetToBeSold();
                assets.push(address(a));
                try {
                    s.completeSale(openOrders[token].purchaser);
                } catch { // Support for legacy sales
                    address(s).call("completeSale");
                }
                openOrders[token].orderLines[seller].saleAddresses[k] = address(0);
                openOrders[token].orderLines[seller].quantities[k] = 0;
            }
            bool success = stratAddress.call("transfer", sellerAddresses[j], openOrders[token].orderLines[seller].total);
            emit Payment(
                token,
                getCommonName(openOrders[token].purchaser),
                seller,
                saleAddresses,
                quantities,
                openOrders[token].orderLines[seller].total,
                0,
                _unitsPerDollar(),
                true
            );
            openOrders[token].orderLines[seller].saleAddresses.length = 0;
            openOrders[token].orderLines[seller].quantities.length = 0;
            openOrders[token].orderLines[seller].total = 0;
            openOrders[token].sellers[j] = "";
        }
        openOrders[token].purchaser = address(0);
        openOrders[token].sellers.length = 0;
        purchasersAddress = address(0); // Support for legacy sales
        purchasersCommonName = "";

        return (token, assets);
    }

    function _completeOrder (
        string token
    ) internal override returns (address[]) {
        require(false, "Cannot call completeSales for STRAT payments.");
    }

    function _unitsPerDollar() internal override returns (uint) {
        return stratsPerDollar * 100;
    }

    function updateStratsPerDollar(uint _stratsPerDollar) requireOwner() public returns (uint) {
      stratsPerDollar = _stratsPerDollar;
      return RestStatus.OK;
    }
}