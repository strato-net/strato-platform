pragma solidvm 11.5;

import <BASE_CODE_COLLECTION>;

contract SimpleTokenFactory is TokenFactory, Tokens {

    string public paymentServiceCreator;
    string public paymentServiceName;

    constructor(string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService,
        string _paymentServiceCreator
        address _redemptionService) Tokens(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) TokenFactory(_name) public {
            token = address(this);
    }

        function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        Tokens newToken = new Tokens(name, description, images, files, fileNames, createdDate, _quantity, status, address(redemptionService), paymentServiceCreator);
        return UTXO(address(newToken)); 
    }

    modifier fromPaymentService(string action) {
        TokenPaymentService ps = TokenPaymentService(msg.sender);
        string err = "Only the current corresponding Payment Service contract can "
                       + action
                       + ".";
        require(ps.tokenAddress() == this.root && address(ps).creator == paymentServiceCreator && ps.serviceName() == paymentServiceName && ps.isActive(), err);
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