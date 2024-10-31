pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of CarbonOffset assets
contract CarbonOffset is Mintable {
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService
    ) Mintable (
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity,
        _status,
        _redemptionService
    ) {
    }

    function mint(uint splitQuantity) internal override returns (UTXO) {
        CarbonOffset c = new CarbonOffset(name,
                              description, 
                              images, 
                              files, 
                              fileNames,
                              createdDate, 
                              splitQuantity,
                              status,
                              address(redemptionService)
                              );
        return UTXO(address(c)); // Typechecker won't let me cast directly to UTXO
    }
}
