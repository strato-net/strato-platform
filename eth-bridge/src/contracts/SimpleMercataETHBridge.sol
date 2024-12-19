pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Token assets
contract SimpleMercataETHBridge is Tokens, MercataETHBridge {

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService
    ) public Tokens(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) MercataETHBridge() {
        ethSt = address(this);
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        BridgeableTokens newToken = new BridgeableTokens(name, description, images, files, fileNames, createdDate, _quantity, status, address(redemptionService));
        return UTXO(address(newToken)); 
    }
}