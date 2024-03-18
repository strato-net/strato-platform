pragma es6;
pragma strict;

import <509>;

/// @title A representation of Carbon assets
abstract contract SemiFungible is Mintable {
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
        SemiFungible sf = new SemiFungible(name,
                              description, 
                              images, 
                              files, 
                              createdDate, 
                              splitQuantity);
        return UTXO(address(sf)); // Typechecker won't let me cast directly to UTXO
    }

    function _callMint(address _newOwner, uint _quantity) internal override{
        for (uint i = 0; i < _quantity; i++) {
            UTXO newAsset = mint(1);
            // regular transfer - isUserTransfer: false, transferNumber: 0
            Asset(newAsset).transferOwnership(_newOwner, 1, false, 0);
        }
        
    }

    function checkCondition() internal virtual override returns (bool){
        return true;   
    }
}