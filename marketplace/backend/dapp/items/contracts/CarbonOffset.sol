pragma es6;
pragma strict;

import <a3d9911aeffee71e0c6cd37946d80f3864b49d45>;

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
