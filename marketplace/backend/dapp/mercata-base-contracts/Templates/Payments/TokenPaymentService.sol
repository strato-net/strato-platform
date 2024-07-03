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

    constructor (
        string _serviceName,
        uint _supply,
        uint _decimals,
        uint _tokensPerDollar,
        string _imageURL,
        string _checkoutText
    ) PaymentService(_serviceName, _imageURL, _checkoutText) public {
        decimals = _decimals;
        reserve = _supply * (10 ** decimals);
        tokensPerDollar = _tokensPerDollar;
        emit Receipt(ReceiptType.MINT, "", "", _supply, block.timestamp);
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
        uint _createdDate
    ) internal override returns (string, address[]) {
        address[] assets;
        decimal totalAmount = 0;
        string seller;
        string err = "Your " + serviceName + " balance is not high enough to cover the purchase.";
        purchasersAddress = msg.sender; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            assets.push(address(a));
            uint quantity = _quantities[i];
            uint amount = uint(s.price() * decimal(quantity) * tokensPerDollar * (10 ** decimals));
            totalAmount += decimal(amount);
            seller = getCommonName(a.owner());
            try {
                Sale(_saleAddresses[i]).lockQuantity(quantity, _purchaser);
            } catch { // Support for legacy sales
                _saleAddresses[i].call("lockQuantity", quantity);
            }
            bool success = transfer(seller, amount);
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
            serviceName,
            PaymentStatus.CLOSED,
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
        uint _createdDate
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
        uint _createdDate
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