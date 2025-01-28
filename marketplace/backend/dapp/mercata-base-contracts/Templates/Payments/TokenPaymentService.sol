pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;
import "../../../items/contracts/Tokens.sol";

contract TokenPaymentService is PaymentService {
    address public tokenAddress;

    address public feeRecipient;

    constructor (
        address _tokenAddress,
        string _serviceName,
        string _imageURL,
        decimal _primarySaleFeePercentage,
        decimal _secondarySaleFeePercentage,
        address _feeRecipient
    ) PaymentService(
        _serviceName,
        _imageURL,
        "Checkout with " + _serviceName,
        _primarySaleFeePercentage,
        _secondarySaleFeePercentage
    ) public {
        tokenAddress = _tokenAddress;
        feeRecipient = _feeRecipient;
    }

    function _checkoutInitialized (
        address[] _tokenAssetAddresses,
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
        string err = "Your " + serviceName + " balance is not high enough to cover the purchase.";
        string feeErr = "Your " + serviceName + " balance is not high enough to cover the fee.";
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
            decimal fee = 0.000000000000000000;
            decimal primarySaleFee = 10.000000000000000000;
            decimal secondarySaleFee = 3.000000000000000000;
            if (address(a) == address(a.root)) {
                fee = (gross * (primarySaleFee / 100.000000000000000000));
            } else {
                fee = (gross * (secondarySaleFee / 100.000000000000000000));
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

            // Calculate net and fee amounts in 18 decimal places
            uint tokenAmountNet = uint(net * (10**18));
            uint tokenFee = uint(fee * (10**18));

            // Transfer token
            uint remainingTokenToTransfer = tokenAmountNet;
            uint remainingFeeToTransfer = tokenFee;
            uint tokenQuantity = 0;
            uint transferAmount = 0;
            uint transferFee = 0;
            uint transferNumber = 0;
            for (uint j = 0; j < _tokenAssetAddresses.length; j++) {
                Tokens tokenAsset = Tokens(_tokenAssetAddresses[j]);
                require(tokenAsset.root == tokenAddress, "Asset is not a " + serviceName  + " asset");
                require(tokenAsset.ownerCommonName() == getCommonName(msg.sender), "Purchaser doesn't own " + serviceName);
                tokenQuantity = tokenAsset.quantity();
                transferNumber = (uint(_checkoutHash, 16) + j) % 1000000;
                if (remainingTokenToTransfer > 0) {
                    transferAmount = tokenQuantity >= remainingTokenToTransfer ? remainingTokenToTransfer : tokenQuantity;
                    tokenAsset.purchaseTransfer(sellerAddress, transferAmount, transferNumber, 1/(10**18));
                    remainingTokenToTransfer -= transferAmount;
                }
                tokenQuantity = tokenQuantity - transferAmount;
                if (remainingFeeToTransfer > 0 && tokenQuantity > 0) {
                    transferNumber = (uint(_checkoutHash, 16) + j + block.timestamp) % 1000000;
                    transferFee = tokenQuantity >= remainingFeeToTransfer ? remainingFeeToTransfer : tokenQuantity;
                    tokenAsset.purchaseTransfer(feeRecipient, transferFee, transferNumber, 1/(10**18));
                    remainingFeeToTransfer -= transferFee;
                }
                transferAmount = 0;
                if (remainingTokenToTransfer == 0 && remainingFeeToTransfer == 0) {
                    break;
                }
            }
            require(remainingTokenToTransfer == 0, err);
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
            1e18,
            serviceName,
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
        require(false, "Cannot call generateIntermediateOrder for " + serviceName + " payments.");
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
        require(false, "Cannot call completeOrder for " + serviceName + " payments.");
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
        require(false, "Cannot call cancelOrder for " + serviceName + " payments.");
    }
}
