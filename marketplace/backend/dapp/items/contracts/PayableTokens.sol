pragma es6;
pragma strict;

import "./Tokens.sol";
import "../../mercata-base-contracts/Templates/Payments/TokenPaymentService.sol";

/// @title A representation of STRATS assets
contract PayableTokens is Tokens {
    string public paymentServiceCreator;
    string public paymentServiceName;

    bool public quantityIsDecimal = true;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService,
        string _paymentServiceCreator
    ) public Tokens(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {
        paymentServiceCreator = _paymentServiceCreator;
        paymentServiceName = _name;
    }
    
    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        PayableTokens newSTRATS = new PayableTokens(name, description, images, files, fileNames, createdDate, _quantity, status, address(redemptionService), paymentServiceCreator, paymentServiceName);
        return UTXO(address(newSTRATS)); 
    }

    modifier fromPaymentService(string action) {
        TokenPaymentService ps = TokenPaymentService(msg.sender);
        string err = "Only the current corresponding Payment Service contract can "
                       + action
                       + ".";
        require(ps.stratAddress() == this.root && address(ps).creator == paymentServiceCreator && ps.serviceName() == paymentServiceName && ps.isActive(), err);
        _;
    }
    
    function purchaseTransfer(address _newOwner, uint _quantity, uint _transferNumber, decimal _price) public fromPaymentService("make a purchase") {
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");
        require(_quantity > 0, "Quantity must be greater than 0");
        // regular transfer - isUserTransfer: false, transferNumber: 0
        // transfer feature - isUserTransfer: true, transferNumber: >0
        _transfer(_newOwner, _quantity, true, _transferNumber, _price);
    }
}