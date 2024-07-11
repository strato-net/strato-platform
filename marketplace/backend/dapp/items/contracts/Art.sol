pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Art assets
contract Art is UTXO {
    string public artist;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        string _artist,
        AssetStatus _status
    ) public UTXO(_name, _description, _images, _files, _fileNames, _createdDate, 1, _status) {
        artist = _artist;
    }
    function mint(uint splitQuantity) internal override returns (UTXO) {
        Art a = new Art(name, description, images, files, fileNames, createdDate, artist, status);
        return UTXO(address(a)); 
    }
}

