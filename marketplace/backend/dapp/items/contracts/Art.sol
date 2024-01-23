pragma es6;
pragma strict;

import <b63644c5e28bb14f2c6f420c8adf318272a419cd>;

/// @title A representation of Art assets
contract Art is UTXO {
    string public artist;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        string _artist
    ) public UTXO(_name, _description, _images, _files, _createdDate, 1) {
        artist = _artist;
    }
    function mint(uint splitQuantity) internal override returns (UTXO) {
        Art a = new Art(name, description, images, files, createdDate, artist);
        return UTXO(address(a)); 
    }
}

