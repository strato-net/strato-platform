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
        uint _decimals,
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
        _decimals,
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
                              decimals,
                              status,
                              address(redemptionService)
                              );
        return UTXO(address(sf)); // Typechecker won't let me cast directly to UTXO
    }

    function _callMint(address _newOwner, uint _quantity) internal override{
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(_quantity > 0, "Quantity must be greater than 0");

        uint unit = 10**decimals;
        uint loopCount = _quantity / unit;
        uint remainder = _quantity % unit;

        // Mint tokens for the full units.
        for (uint i = 0; i < loopCount; i++) {
            UTXO newAsset = mint(unit);
            // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice: 0
            Asset(newAsset).transferOwnership(_newOwner, unit, false, 0, 0);
        }
        
        // If there's a remainder, mint it as a separate token.
        if (remainder > 0) {
            UTXO newAsset = mint(remainder);
            Asset(newAsset).transferOwnership(_newOwner, remainder, false, 0, 0);
        }
    }

    function checkCondition() internal virtual override returns (bool){
        return true;   
    }
}