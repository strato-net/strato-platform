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
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        uint _createdDate
    ) internal override returns (string, address[]) {
        address[] assets;
        uint totalAmount = 0;
        string seller;
        string err = "Your STRAT balance is not high enough to cover the purchase.";
        purchasersAddress = msg.sender; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            uint quantity = _quantities[i];
            uint amount = s.price() * quantity * stratsPerDollar * 100;
            totalAmount += amount;
            address sellerAddress = a.owner();
            seller = getCommonName(sellerAddress);
            try {
                Sale(_saleAddresses[i]).lockQuantity(quantity, _purchaser);
            } catch { // Support for legacy sales
                _saleAddresses[i].call("lockQuantity", quantity);
            }
            bool success = stratAddress.call("transfer", sellerAddress, amount);
            require(success, err);
            try {
                s.completeSale(_purchaser);
            } catch { // Support for legacy sales
                address(s).call("completeSale");
            }
        }
        emit Order(
            _orderHash,
            _orderId,
            _purchaser,
            _purchasersCommonName,
            seller,
            _saleAddresses,
            _quantities,
            totalAmount,
            0,
            _unitsPerDollar(),
            "STRAT",
            PaymentStatus.ORDER_COMPLETED,
            _createdDate
        );
        purchasersAddress = address(0); // Support for legacy sales
        purchasersCommonName = "";
        return (_orderHash, assets);
    }

    function _initializePayment (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchaserCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) internal override {
        require(false, "Cannot call initializePayment for STRAT payments.");
    }

    function _completeOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchaserCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) internal override returns (address[]) {
        require(false, "Cannot call completeOrder for STRAT payments.");
        return [];
    }

    function _cancelOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchaserCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate
    ) internal override {
        require(false, "Cannot call cancelOrder for STRAT payments.");
    }

    function _unitsPerDollar() internal override returns (uint) {
        return stratsPerDollar * 100;
    }

    function updateStratsPerDollar(uint _stratsPerDollar) requireOwner() public returns (uint) {
      stratsPerDollar = _stratsPerDollar;
      return RestStatus.OK;
    }
}