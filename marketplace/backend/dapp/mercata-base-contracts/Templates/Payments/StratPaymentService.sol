pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract StratPaymentService is PaymentService {
    address public stratAddress;
    decimal public stratsPerDollar;

    address public feeRecipient;

    constructor (
        address _stratAddress,
        decimal _stratsPerDollar,
        string _imageURL,
        decimal _primarySaleFeePercentage,
        decimal _secondaySaleFeePercentage,
        address _feeRecipient
    ) PaymentService(
        "STRATS",
        _imageURL,
        "Checkout with STRATS",
        _primarySaleFeePercentage,
        _secondaySaleFeePercentage
    ) public {
        stratAddress = _stratAddress;
        stratsPerDollar = _stratsPerDollar;
        feeRecipient = _feeRecipient;
    }

    function _createOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        uint _createdDate,
        string _comments
    ) internal override returns (string, address[]) {
        address[] assets;
        decimal totalAmountGross = 0.0;
        decimal totalAmountNet = 0.0;
        decimal totalFee = 0.0;
        string seller;
        string err = "Your STRATS balance is not high enough to cover the purchase.";
        string feeErr = "Your STRATS balance is not high enough to cover the fee.";
        purchasersAddress = msg.sender; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);

        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            address sellerAddress = a.owner();
            seller = getCommonName(sellerAddress);
            uint quantity = _quantities[i];

            // Lock assets
            try {
                s.lockQuantity(quantity, _orderHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    address(s).call("lockQuantity", quantity, _purchaser);
                } catch {
                    address(s).call("lockQuantity", quantity);
                }
            }
            emit AssetLocked(
                _orderHash,
                _orderId,
                _purchaser,
                _purchasersCommonName,
                seller,
                _saleAddresses,
                _quantities,
                totalAmountGross,
                0,
                0,
                _unitsPerDollar(),
                "STRATS",
                PaymentStatus.AWAITING_FULFILLMENT,
                _createdDate,
                _comments
            );

            // Calculate gross, net, and fee amounts in dollars
            decimal gross = s.price() * decimal(quantity); 
            decimal fee = 0.0;
            if (address(a) == address(a.root)) {
                fee = (gross * primarySaleFeePercentage) / 100;
            } else {
                fee = (gross * secondarySaleFeePercentage) / 100;
            }
            decimal net = gross - fee;
            totalAmountGross += gross;
            totalAmountNet += net;
            totalFee += fee;

            // Calculate net and fee amounts in STRATS
            uint stratAmountNet = uint(net * stratsPerDollar * 100);
            uint stratFee = uint(fee * stratsPerDollar * 100);

            // Transfer strats
            bool success = stratAddress.call("transfer", sellerAddress, stratAmountNet);
            require(success, err);
            success = stratAddress.call("transfer", feeRecipient, stratFee);
            require(success, feeErr);

            // Transfer assets
            try {
                s.completeSale(_orderHash, _purchaser);
            } catch {
                try {
                    address(s).call("completeSale", _purchaser);
                } catch { // Support for legacy sales
                    address(s).call("completeSale");
                }
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
            totalAmountGross,
            0,
            totalFee,
            _unitsPerDollar(),
            "STRATS",
            PaymentStatus.CLOSED,
            _createdDate,
            _comments
        );
        purchasersAddress = address(0); // Support for legacy sales
        purchasersCommonName = "";
        return (_orderHash, assets);
    }

    function updateFeeRecipient(
        address _feeRecipient
    ) requireOwner("update fee recipient") external {
        feeRecipient = _feeRecipient;
    }

    function _initializePayment (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate,
        string _comments
    ) internal override returns (address[]) {
        require(false, "Cannot call initializePayment for STRATS payments.");
        return [];
    }

    function _completeOrder (
        string _orderHash,
        string _orderId,
        address _purchaser,
        string _purchaserCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate,
        string _comments
    ) internal override returns (address[]) {
        require(false, "Cannot call completeOrder for STRATS payments.");
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
        uint _createdDate,
        string _comments
    ) internal override {
        require(false, "Cannot call cancelOrder for STRATS payments.");
    }

    function _unitsPerDollar() internal override returns (decimal) {
        return stratsPerDollar * 100;
    }

    function updateStratsPerDollar(decimal _stratsPerDollar) requireOwner() public returns (uint) {
      stratsPerDollar = _stratsPerDollar;
      return RestStatus.OK;
    }
}
