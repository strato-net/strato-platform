pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Clothing assets
contract Clothing is Mintable {
    string public clothingType; 
    string public size; 
    string public skuNumber; 
    string public condition;
    string public brand;

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
        string _clothingType,
        string _size,
        string _skuNumber,
        string _condition,
        string _brand,
        AssetStatus _status,
        address _redemptionService
    ) public Mintable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {
        clothingType = _clothingType;
        size = _size;
        skuNumber = _skuNumber;
        condition = _condition;
        brand = _brand;
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        Clothing newAsset = new Clothing(
            name,
            description,
            images,
            files,
            fileNames,
            createdDate,
            _quantity,
            clothingType,
            size,
            skuNumber,
            condition,
            brand,
            status,
            address(redemptionService)
        );
        return UTXO(address(newAsset));
    }

    // TODO: Finish the update function. 
    function updateClothing(
        string[] _images, 
        string[] _files,
        string[] _fileNames, 
        string _clothingType
    ) public requireOwner("update clothing") returns (uint) {
        clothingType = _clothingType;
        updateAsset(_images, _files, _fileNames);
        return RestStatus.OK;
    }
}