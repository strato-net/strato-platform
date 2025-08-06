import <BASE_CODE_COLLECTION>;

/// @title A representation of Token assets
contract BridgeableTokens is Tokens, MercataETHBridge {

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        uint _decimals,
        AssetStatus _status,
        address _redemptionService,
        string _paymentServiceCreator
    ) public Tokens(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _decimals, _status, _redemptionService, _paymentServiceCreator) MercataETHBridge(_decimals) {
        ethSt = address(this);
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        BridgeableTokens newToken = new BridgeableTokens(name, description, images, files, fileNames, createdDate, _quantity, decimals, status, address(redemptionService), paymentServiceCreator);
        return UTXO(address(newToken));
    }
}