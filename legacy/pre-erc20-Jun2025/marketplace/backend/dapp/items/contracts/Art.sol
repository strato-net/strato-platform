import <BASE_CODE_COLLECTION>;

/// @title A representation of Art assets
contract Art is Redeemable {
    string public artist;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        uint _decimals,
        string _artist,
        AssetStatus _status,
        address _redemptionService
    ) public Redeemable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _decimals, _status, _redemptionService) {
        artist = _artist;
    }
    function mint(uint splitQuantity) internal override returns (UTXO) {
        Art a = new Art(name, description, images, files, fileNames, createdDate, splitQuantity, decimals, artist, status, address(redemptionService));
        return UTXO(address(a)); 
    }
}

