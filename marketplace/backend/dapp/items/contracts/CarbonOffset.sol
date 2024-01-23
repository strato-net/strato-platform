pragma es6;
pragma strict;

import <cb12755ba7a59561f5d6def5b53e6282ccdab802>;

/// @title A representation of CarbonOffset assets
contract CarbonOffset is Mintable {
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity
    ) Mintable (
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity
    ) {
    }

    function mint(uint splitQuantity) internal override returns (UTXO) {
        CarbonOffset c = new CarbonOffset(name,
                              description, 
                              images, 
                              files, 
                              createdDate, 
                              splitQuantity);
        return UTXO(address(c)); // Typechecker won't let me cast directly to UTXO
    }
}
