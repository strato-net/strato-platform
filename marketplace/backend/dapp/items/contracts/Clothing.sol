pragma es6;
pragma strict;

import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

/// @title A representation of Clothing assets
contract Clothing is Mintable {
    string public serialNumber;
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
        uint _createdDate,
        uint _quantity,
        string _serialNumber,
        string _clothingType,
        string _size,
        string _skuNumber,
        string _condition,
        string _brand
    ) public Mintable(_name, _description, "Clothing", "Clothing", _images, _files, _createdDate, _quantity) {
        serialNumber = _serialNumber;
        clothingType = _clothingType;
        size = _size;
        skuNumber = _skuNumber;
        condition = _condition;
        brand = _brand;
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        Clothing newAsset = new Clothing(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity,
            serialNumber,
            clothingType,
            size,
            skuNumber,
            condition,
            brand
        );
        return UTXO(newAsset);
    }

    // TODO: Finish the update function. 
    function updateClothing(
        string[] _images, 
        string[] _files, 
        string _serialNumber,
        string _clothingType
    ) public requireOwner("update clothing") returns (uint) {
        serialNumber = _serialNumber;
        clothingType = _clothingType;
        updateAsset(_images, _files);
        return RestStatus.OK;
    }
}