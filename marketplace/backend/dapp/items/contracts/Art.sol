pragma es6;
pragma strict;

import <2813f256f50370bca8e294ddb7183096cac2099e>;

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

