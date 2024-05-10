pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Token assets
contract Tokens is Mintable {

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
    ) public Mintable(_name, _description, _images, _files, _createdDate, _quantity, _status) {}

    function mint(uint _quantity) internal override returns (UTXO) {
        Tokens newToken = new Tokens(name, description, images, files, createdDate, _quantity, status);
        return UTXO(address(newToken)); 
    }
}