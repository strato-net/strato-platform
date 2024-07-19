pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract TokenPaymentService is PaymentService {   
    // TODO: receipts for minting/removing?
    enum ReceiptType { TRANSFER, PURCHASE, MINT }
    event Receipt(ReceiptType type, string _from, string _to, uint _value, uint timestamp);

    event Transfer(string _from, string _to, uint _value);
    event Approval(string _owner, string _spender, uint _value);

    // token data
    uint public reserve;
    uint public decimals;
    decimal public tokensPerDollar;
    mapping (string => uint) public record balances;

    string public feeRecipient;

constructor (
        string _serviceName,
        uint _supply,
        uint _decimals,
        decimal _tokensPerDollar,
        string _imageURL,
        string _checkoutText,
        decimal _primarySaleFeePercentage,
        decimal _secondaySaleFeePercentage,
        string _feeRecipient
    ) PaymentService(
        _serviceName,
        _imageURL,
        _checkoutText,
        _primarySaleFeePercentage,
        _secondaySaleFeePercentage
    ) public {
        decimals = _decimals;
        reserve = _supply * (10 ** decimals);
        tokensPerDollar = _tokensPerDollar;
        feeRecipient = _feeRecipient;
        emit Receipt(ReceiptType.MINT, "", "", _supply, block.timestamp);
    }

    function updateFeeRecipient(
        string _feeRecipient
    ) requireOwner("update fee recipient") external {
        feeRecipient = _feeRecipient;
    }

    // OWNER/PROVIDER FUNCTIONS
    function reserveBalance() requireOwner() external returns (uint) {
      return _balanceOf(ownerCommonName);
    }

    function transfer(string _to, uint _value) public returns (bool) {
        string senderCommonName = getCommonName(msg.sender);
        if (senderCommonName == ownerCommonName) { // if provider, send balance from the reserve
            if (reserve < _value) { return false; }
            balances[_to] += _value;
            reserve -= _value;
            emit Receipt(ReceiptType.PURCHASE, "", _to, _value, block.timestamp);
            return true;
        }

        if (balances[senderCommonName] < _value) { return false; }
        balances[_to] += _value;
        balances[senderCommonName] -= _value;
        emit Receipt(ReceiptType.TRANSFER, senderCommonName, _to, _value, block.timestamp);
        return true;
    }

    function balance() public returns (uint) {
        return _balanceOf(getCommonName(msg.sender));
    }
    
    function balanceOf(string _user) requireOwner() external returns (uint) {
        return _balanceOf(_user);
    }

    function _balanceOf(string _user) internal returns (uint) {
        if (_user == ownerCommonName) {
            return reserve;
        } else {
            return balances[_user];
        }
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
        string err = "Your " + serviceName + " balance is not high enough to cover the purchase.";
        string feeErr = "Your " + serviceName + " balance is not high enough to cover the fee.";
        purchasersAddress = msg.sender; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);

        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            seller = getCommonName(a.owner());
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
                serviceName,
                PaymentStatus.AWAITING_FULFILLMENT,
                _createdDate,
                _comments
            );

            // Calculate gross, net, and fee amounts in dollars
            decimal gross = s.price() * decimal(quantity); 
            decimal fee = 0.0;
            totalAmountGross += gross;
            if (address(a) == address(a.root)) {
                fee = (gross * primarySaleFeePercentage) / 100;
            } else {
                fee = (gross * secondarySaleFeePercentage) / 100;
            }
            decimal net = gross - fee;
            totalAmountNet += net;
            totalFee += fee;

            // Calculate net and fee amounts in tokens
            uint tokenAmountNet = uint(net * tokensPerDollar * (10 ** decimals));
            uint tokenFee = uint(fee * tokensPerDollar * (10 ** decimals));

            // Transfer tokens
            bool success = transfer(seller, tokenAmountNet);
            require(success, err);
            success = transfer(feeRecipient, tokenFee);
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
            serviceName,
            PaymentStatus.CLOSED,
            _createdDate,
            _comments
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
        uint _createdDate,
        string _comments
    ) internal override returns (address[]) {
        require(false, "Cannot call initializePayment for token payments.");
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
        require(false, "Cannot call completeOrder for token payments.");
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
        require(false, "Cannot call cancelOrder for token payments.");
    }

    function _unitsPerDollar() internal override returns (decimal) {
        return tokensPerDollar * (10 ** decimals);
    }

    function updateTokensPerDollar(decimal _tokensPerDollar) requireOwner() public returns (uint) {
      tokensPerDollar = _tokensPerDollar;
      return RestStatus.OK;
    }
}