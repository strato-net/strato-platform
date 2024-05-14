pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Art assets
contract Art is Redeemable {
    string public artist;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        string _artist,
        AssetStatus _status,
        address _redemptionService
    ) public Redeemable(_name, _description, _images, _files, _createdDate, 1, _status, _redemptionService) {
        artist = _artist;
    }
    function mint(uint splitQuantity) internal override returns (UTXO) {
        Art a = new Art(name, description, images, files, createdDate, artist, status, address(redemptionService));
        return UTXO(address(a)); 
    }
}

