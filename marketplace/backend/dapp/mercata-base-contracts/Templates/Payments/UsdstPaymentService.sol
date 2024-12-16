pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;
import "../../../items/contracts/USDST.sol";

contract usdstPaymentService is PaymentService {
    address public usdstAddress;
    decimal public usdstPerDollar;

    address public feeRecipient;

    event LoanRepaid(address indexed user, address escrow, uint assetAmount, decimal repayment);

    constructor (
        address _usdstAddress,
        decimal _usdstPerDollar,
        string _imageURL,
        decimal _primarySaleFeePercentage,
        decimal _secondarySaleFeePercentage,
        address _feeRecipient
    ) PaymentService(
        "USDST",
        _imageURL,
        "Checkout with USDST",
        _primarySaleFeePercentage,
        _secondarySaleFeePercentage
    ) public {
        usdstAddress = _usdstAddress;
        usdstPerDollar = _usdstPerDollar;
        feeRecipient = _feeRecipient;
    }

    function _checkoutInitialized (
        address[] _usdstAssetAddresses,
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
        string err = "Your USDST balance is not high enough to cover the purchase.";
        string feeErr = "Your USDST balance is not high enough to cover the fee.";
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

            // Calculate net and fee amounts in USDST
            uint usdstAmountNet = uint(net * usdstPerDollar * 100);
            uint usdstFee = uint(fee * usdstPerDollar * 100);

            // Transfer USDST
            uint remainingUsdstToTransfer = usdstAmountNet;
            uint remainingFeeToTransfer = usdstFee;
            uint usdstQuantity = 0;
            uint transferAmount = 0;
            uint transferFee = 0;
            uint transferNumber = 0;
            for (uint j = 0; j < _usdstAssetAddresses.length; j++) {
                USDSTTokens usdstAsset = USDSTTokens(_usdstAssetAddresses[j]);
                require(usdstAsset.root == usdstAddress, "Asset is not a USDST asset");
                require(usdstAsset.ownerCommonName() == getCommonName(msg.sender), "Purchaser doesn't own USDST");
                usdstQuantity = usdstAsset.quantity();
                transferNumber = (uint(_checkoutHash, 16) + j) % 1000000;
                if (remainingUsdstToTransfer > 0) {
                    transferAmount = usdstQuantity >= remainingUsdstToTransfer ? remainingUsdstToTransfer : usdstQuantity;
                    usdstAsset.purchaseTransfer(sellerAddress, transferAmount, transferNumber, 0.0001);
                    remainingUsdstToTransfer -= transferAmount;
                }
                usdstQuantity = usdstQuantity - transferAmount;
                if (remainingFeeToTransfer > 0 && usdstQuantity > 0) {
                    transferNumber = (uint(_checkoutHash, 16) + j + block.timestamp) % 1000000;
                    transferFee = usdstQuantity >= remainingFeeToTransfer ? remainingFeeToTransfer : usdstQuantity;
                    usdstAsset.purchaseTransfer(feeRecipient, transferFee, transferNumber, 0.0001);
                    remainingFeeToTransfer -= transferFee;
                }
                transferAmount = 0;
                if (remainingUsdstToTransfer == 0 && remainingFeeToTransfer == 0) {
                    break;
                }
            }
            require(remainingUsdstToTransfer == 0, err);
            require(remainingFeeToTransfer == 0, feeErr);

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
            "USDST",
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
        require(false, "Cannot call generateIntermediateOrder for USDST payments.");
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
        require(false, "Cannot call completeOrder for USDST payments.");
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
        require(false, "Cannot call cancelOrder for USDST payments.");
    }

    function _unitsPerDollar() internal override returns (decimal) {
        return usdstPerDollar * 100;
    }

    function updateUsdstPerDollar(decimal _usdstPerDollar) requireOwner("updateUsdstPerDollar") public returns (uint) {
      usdstPerDollar = _usdstPerDollar;
      return RestStatus.OK;
    }
}
