pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract StratPaymentService is PaymentService {
    decimal public stratsPerDollar;

    address public feeRecipient;

    constructor (
        decimal _stratsPerDollar,
        string _imageURL,
        decimal _primarySaleFeePercentage,
        decimal _secondarySaleFeePercentage,
        address _feeRecipient
    ) PaymentService(
        "STRATS",
        _imageURL,
        "Checkout with STRATS",
        _primarySaleFeePercentage,
        _secondarySaleFeePercentage
    ) public {
        stratsPerDollar = _stratsPerDollar;
        feeRecipient = _feeRecipient;
    }

    function _checkoutInitialized (
        address[] _stratsAssetAddresses,
        string _checkoutHash,
        string _checkoutId,
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
        string sellerCommonName;
        address sellerAddress;
        string err = "Your STRATS balance is not high enough to cover the purchase.";
        string feeErr = "Your STRATS balance is not high enough to cover the fee.";
        purchasersAddress = msg.sender; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);

        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            sellerAddress = a.owner();
            sellerCommonName = getCommonName(sellerAddress);
            uint quantity = _quantities[i];

            // Lock assets
            try {
                s.lockQuantity(quantity, _checkoutHash, _purchaser);
            } catch { // Support for legacy sales
                try {
                    address(s).call("lockQuantity", quantity, _purchaser);
                } catch {
                    address(s).call("lockQuantity", quantity);
                }
            }

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

            if(i == _saleAddresses.length -1)
            {
                emit Checkout(
                    _checkoutHash,
                    _checkoutId,
                    _purchaser,
                    _purchasersCommonName,
                    _saleAddresses,
                    _quantities,
                    totalAmountGross
                );
            }

            // Calculate net and fee amounts in STRATS
            uint stratAmountNet = uint(net * stratsPerDollar * 100);
            uint stratFee = uint(fee * stratsPerDollar * 100);

            // Transfer STRATS
            uint remainingStratsToTransfer = stratAmountNet;
            uint remainingFeeToTransfer = stratFee;
            uint stratQuantity = 0;
            uint transferAmount = 0;
            uint transferFee = 0;

            for (uint j = 0; j < _stratsAssetAddresses.length; j++) {
                Asset stratAsset = Asset(_stratsAssetAddresses[j]);
                stratQuantity = stratAsset.quantity();

                if (remainingStratsToTransfer > 0) {
                    transferAmount = stratQuantity >= remainingStratsToTransfer ? remainingStratsToTransfer : stratQuantity;
                    stratAsset.transferOwnership(sellerAddress, transferAmount, false, 0, 0);
                    remainingStratsToTransfer -= transferAmount;
                }
                stratQuantity = stratQuantity - transferAmount;
                if (remainingFeeToTransfer > 0 && stratQuantity > 0) {
                    
                    transferFee = stratQuantity >= remainingFeeToTransfer ? remainingFeeToTransfer : stratQuantity;
                    stratAsset.transferOwnership(feeRecipient, transferFee, false, 0, 0);
                    remainingFeeToTransfer -= transferFee;
                }

                if (remainingStratsToTransfer == 0 && remainingFeeToTransfer == 0) {
                    break;
                }
            }
            require(remainingStratsToTransfer == 0 && remainingFeeToTransfer == 0, "Failed to fulfill STRATS payment");

            // Transfer assets
            try {
                s.completeSale(_checkoutHash, _purchaser);
            } catch {
                try {
                    address(s).call("completeSale", _purchaser);
                } catch { // Support for legacy sales
                    address(s).call("completeSale");
                }
            }
        }
        emit Order(
            _checkoutHash,
            _checkoutId,
            _purchaser,
            _purchasersCommonName,
            sellerCommonName,
            sellerAddress,
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
        return (_checkoutHash, assets);
    }

    function updateFeeRecipient(
        address _feeRecipient
    ) requireOwner("update fee recipient") external {
        feeRecipient = _feeRecipient;
    }

    function _generateIntermediateOrder (
        string _checkoutHash,
        string _orderId,
        address _purchaser,
        string _purchasersCommonName,
        address[] _saleAddresses,
        uint[] _quantities,
        string _currency,
        uint _createdDate,
        string _comments
    ) internal override returns (address[]) {
        require(false, "Cannot call generateIntermediateOrder for STRATS payments.");
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
