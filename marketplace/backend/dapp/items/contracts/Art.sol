pragma es6;
pragma strict;

import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Art assets
contract Art is UTXO {
    string public artist;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        string _artist,
        AssetStatus _status
    ) public UTXO(_name, _description, _images, _files, _createdDate, 1, _status) {
        artist = _artist;
    }
    function mint(uint splitQuantity) internal override returns (UTXO) {
        Art a = new Art(name, description, images, files, createdDate, artist, status);
        return UTXO(address(a)); 
    }
}

