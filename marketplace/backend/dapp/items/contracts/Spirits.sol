pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract UnitOfMeasurement {
enum UnitOfMeasurement {
    NULL,
    BARREL,
    BOTTLE,
    LITER
}
}

/// @title A representation of Spirit assets
contract Spirits is Mintable, UnitOfMeasurement {
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
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        string _spiritType,
        UnitOfMeasurement _unitOfMeasurement,
        AssetStatus _status,
        address _redemptionService
    ) public Mintable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {
        unitOfMeasurement = _unitOfMeasurement;
        spiritType = _spiritType;
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        Spirits newAsset = new Spirits(
            name,
            description,
            images,
            files,
            fileNames,
            createdDate,
            _quantity,
            spiritType,
            unitOfMeasurement, 
            status,
            address(redemptionService)
        );
        return UTXO(address(newAsset));
    }
}
