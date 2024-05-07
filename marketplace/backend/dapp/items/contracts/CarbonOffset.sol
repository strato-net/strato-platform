pragma es6;
pragma strict;

import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of CarbonOffset assets
contract CarbonOffset is Mintable {
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
    ) Mintable (
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity,
        _status
    ) {
    }

    function mint(uint splitQuantity) internal override returns (UTXO) {
        CarbonOffset c = new CarbonOffset(name,
                              description, 
                              images, 
                              files, 
                              createdDate, 
                              splitQuantity,
                              status
                              );
        return UTXO(address(c)); // Typechecker won't let me cast directly to UTXO
    }
}
