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
        SemiFungible sf = new SemiFungible(name,
                              description, 
                              images, 
                              files, 
                              fileNames,
                              createdDate, 
                              splitQuantity,
                              status,
                              address(redemptionService)
                              );
        return UTXO(address(sf)); // Typechecker won't let me cast directly to UTXO
    }

    function _callMint(address _newOwner, uint _quantity) internal override{
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        for (uint i = 0; i < _quantity; i++) {
            UTXO newAsset = mint(1);
            // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice:0
            Asset(newAsset).transferOwnership(_newOwner, 1, false, 0, 0);
        }
        
    }

    function checkCondition() internal virtual override returns (bool){
        return true;   
    }
}