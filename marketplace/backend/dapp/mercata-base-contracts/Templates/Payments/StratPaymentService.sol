
contract StratPaymentService is PaymentService {
    address public stratAddress;
    decimal public stratsPerDollar;

    address public feeRecipient;

    constructor (
        address _stratAddress,
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
        stratAddress = _stratAddress;
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
            sellerAddress = a.getCurrentOwner();
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
            uint remainingFeeToTransferToBA = stratFee/2;
            uint remainingFeeToTransferToProposer = stratFee - remainingFeeToTransferToBA;
            uint stratQuantity = 0;
            uint transferAmount = 0;
            uint transferFee = 0;
            uint transferNumber = 0;
            for (uint j = 0; j < _stratsAssetAddresses.length; j++) {
                STRATSTokens stratAsset = STRATSTokens(_stratsAssetAddresses[j]);
                require(stratAsset.root == stratAddress, "Asset is not a STRATS asset");
                stratQuantity = stratAsset.quantity();
                transferNumber = (uint(_checkoutHash, 16) + j) % 1000000;
                if (remainingStratsToTransfer > 0) {
                    transferAmount = stratQuantity >= remainingStratsToTransfer ? remainingStratsToTransfer : stratQuantity;
                    stratAsset.purchaseTransfer(sellerAddress, transferAmount, transferNumber, 0.0001);
                    remainingStratsToTransfer -= transferAmount;
                }
                stratQuantity = stratQuantity - transferAmount;
                if (remainingFeeToTransferToBA > 0 && stratQuantity > 0) {
                    transferNumber = (uint(_checkoutHash, 16) + j + block.timestamp) % 1000000;
                    transferFee = stratQuantity >= remainingFeeToTransferToBA ? remainingFeeToTransferToBA : stratQuantity;
                    stratAsset.purchaseTransfer(feeRecipient, transferFee, transferNumber, 0.0001);
                    remainingFeeToTransferToBA -= transferFee;
                }
                if (remainingFeeToTransferToProposer > 0 && stratQuantity > 0) {
                    transferNumber = (uint(_checkoutHash, 16) + j + block.timestamp) % 1000000;
                    transferFee = stratQuantity >= remainingFeeToTransferToProposer ? remainingFeeToTransferToProposer : stratQuantity;
                    s.assetToBeSold().payFeesToProposer(stratAsset, transferFee, transferNumber);
                    remainingFeeToTransferToProposer -= transferFee;
                }
                transferAmount = 0;

                if (remainingStratsToTransfer == 0 && remainingFeeToTransferToBA == 0 && remainingFeeToTransferToProposer ==0) {
                    break;
                }
            }
            require(remainingStratsToTransfer == 0, err);
            require(remainingFeeToTransferToBA == 0, feeErr);
            require(remainingFeeToTransferToProposer == 0, feeErr);

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
            _comments,
            block.proposer
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
