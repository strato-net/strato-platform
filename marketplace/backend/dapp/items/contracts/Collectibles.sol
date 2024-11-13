pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Collectible assets
contract Collectibles is Mintable {
    string public condition;

    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        string _condition,
        AssetStatus _status,
        address _redemptionService
    ) public Mintable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {
        condition = _condition;
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        Collectibles newAsset = new Collectibles(
            name,
            description,
            images,
            files,
            fileNames,
            createdDate,
            _quantity,
            condition,
            status,
            address(redemptionService)
        );
        return UTXO(address(newAsset));
    }

    // TODO: Finish the update function. 
    function updateCollectible(
        string[] _images, 
        string[] _files,
        string[] _fileNames
    ) public requireOwner("update collectible") returns (uint) {
        updateAsset(_images, _files, _fileNames);
        return RestStatus.OK;
    }
}