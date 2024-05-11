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
    uint public tokensPerDollar;
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
        address[] _saleAddresses,
        uint[] _quantities,
        string token
    ) internal override returns (string, address[]) {
        address[] assets;
        uint totalAmount;
        openOrders[token].purchaser = msg.sender;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            string seller = getCommonName(a.owner());
            uint quantity = _quantities[i];
            openOrders[token].orderLines[seller].saleAddresses.push(_saleAddresses[i]);
            openOrders[token].orderLines[seller].quantities.push(quantity);
            uint amount = s.price() * quantity * tokensPerDollar * (10 ** decimals);
            if (openOrders[token].orderLines[seller].total == 0) {
                openOrders[token].sellers.push(seller);
            }
            openOrders[token].orderLines[seller].total += amount;
            totalAmount += amount;
            try {
                s.lockQuantity(quantity, msg.sender);
            } catch { // Support for legacy sales
                address(s).call("lockQuantity", quantity);
            }
        }
        string err = "Your " + serviceName + " balance is not high enough to cover the purchase.";
        uint myBalance = balance();
        require(myBalance >= totalAmount, err);
        purchasersAddress = msg.sender; // Support for legacy sales
        purchasersCommonName = getCommonName(tx.origin);
        for (uint j = 0; j < openOrders[token].sellers.length; j++) {
            string seller = openOrders[token].sellers[j];
            address[] saleAddresses;
            uint[] quantities;
            for (uint k = 0; k < openOrders[token].orderLines[seller].saleAddresses.length; k++) {
                address saleAddress = openOrders[token].orderLines[seller].saleAddresses[k];
                quantities.push(openOrders[token].orderLines[seller].quantities[k]);
                saleAddresses.push(saleAddress);
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
            bool success = transfer(seller, openOrders[token].orderLines[seller].total);
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
        return tokensPerDollar * (10 ** decimals);
    }

    function updateTokensPerDollar(uint _tokensPerDollar) requireOwner() public returns (uint) {
      tokensPerDollar = _tokensPerDollar;
      return RestStatus.OK;
    }
}