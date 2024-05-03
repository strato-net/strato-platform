pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract UnitOfMeasurement {
enum UnitOfMeasurement {
    NULL,
    BL,              // Barrell
    BT               // Bottle
}
}

/// @title A representation of Spirit assets
contract Spirits is UnitOfMeasurement {
    UnitOfMeasurement public unitOfMeasurement;
    string public spiritType;

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
        string _spiritType,
        UnitOfMeasurement _unitOfMeasurement,
        AssetStatus _status
    ) public Mintable(_name, _description, _images, _files, _createdDate, _quantity, _status) {
        unitOfMeasurement = _unitOfMeasurement;
        spiritType = _spiritType;
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        Spirit newAsset = new Spirit(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity,
            spiritType, 
            status
        );
        return UTXO(address(newAsset));
    }

    // TODO: Finish the update function. 
    function updateSpirit(
        string[] _images, 
        string[] _files, 
        string _spiritType
    ) public requireOwner("update spirit") returns (uint) {
        spiritType = _spiritType;
        updateAsset(_images, _files);
        return RestStatus.OK;
    }
}
