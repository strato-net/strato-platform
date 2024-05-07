pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract TokenPaymentService is PaymentService {   
    // TODO: receipts for minting/removing?
    enum ReceiptType { TRANSFER, PURCHASE, MINT }
    event Receipt(ReceiptType type, address _from, address _to, uint _value, uint timestamp);

    event Transfer(address _from, address _to, uint _value);
    event Approval(address _owner, address _spender, uint _value);

    // token data
    uint public reserve;
    uint public decimals;
    uint public tokensPerDollar;
    mapping (address => uint) public record balances;

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
        emit Receipt(ReceiptType.MINT, address(0), address(0), _supply, block.timestamp);
    }

    // OWNER/PROVIDER FUNCTIONS
    function reserveBalance() requireOwner() external returns (uint) {
      return _balanceOf(owner);
    }

    function transfer(address _to, uint _value) public returns (bool) {
        if (msg.sender == owner) { // if provider, send balance from the reserve
            if (reserve < _value) { return false; }
            balances[_to] += _value;
            reserve -= _value;
            emit Receipt(ReceiptType.PURCHASE, address(0), _to, _value, block.timestamp);
            return true;
        }

        if (balances[msg.sender] < _value) { return false; }
        balances[_to] += _value;
        balances[msg.sender] -= _value;
        emit Receipt(ReceiptType.TRANSFER, msg.sender, _to, _value, block.timestamp);
        return true;
    }

    function balance() public returns (uint) {
        return _balanceOf(msg.sender);
    }
    
    function balanceOf(address _user) requireOwner() external returns (uint) {
        return _balanceOf(_user);
    }

    function _balanceOf(address _user) internal returns (uint) {
        if (_user == owner) {
            return reserve;
        } else {
            return balances[_user];
        }
    }

    function _createOrder (
        address[] _saleAddresses,
        uint[] _quantities,
        string token
    ) internal override returns (string) {
        address[] recipients;
        uint totalAmount;
        for (uint i = 0; i < _saleAddresses.length; i++) {
            Sale s = Sale(_saleAddresses[i]);
            Asset a = s.assetToBeSold();
            address recipient = a.owner();
            if (quantitiesMap[recipient] == 0) {
                recipients.push(recipient);
            }
            uint quantity = _quantities[i];
            uint amount = s.price() * quantity * tokensPerDollar * (10 ** decimals);
            totalAmount += amount;
            quantitiesMap[recipient] += amount;
            s.lockQuantity(quantity, msg.sender);
            s.completeSale(msg.sender);
        }
        string err = "Your " + serviceName + " balance is not high enough to cover the purchase.";
        uint myBalance = balance();
        require(myBalance >= totalAmount, err);
        for (uint j = 0; j < recipients.length; j++) {
            address recipient = recipients[j];
            bool success = transfer(recipient, quantitiesMap[recipient]);
            emit Payment(getCommonName(msg.sender), getCommonName(recipient), quantitiesMap[recipient], true);
            quantitiesMap[recipient] = 0;
            require(success, err);
        }

        return token;
    }

    function _completeOrder (
        string token
    ) internal override returns (address[]) {
        require(false, "Cannot call completeSales for STRAT payments.");
    }

    function updateTokensPerDollar(uint _tokensPerDollar) requireOwner() public returns (uint) {
      tokensPerDollar = _tokensPerDollar;
      return RestStatus.OK;
    }
}