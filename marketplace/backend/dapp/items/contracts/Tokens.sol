pragma es6;
pragma strict;

import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Token assets
contract Tokens is Mintable {

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity
    ) public Mintable(_name, _description, _images, _files, _createdDate, _quantity) {}

    function mint(uint _quantity) internal override returns (UTXO) {
        Tokens newToken = new Tokens(name, description, images, files, createdDate, _quantity);
        return UTXO(address(newToken)); 
    }
}