pragma es6;
pragma strict;

import <8f8d4cef7232db7001bae657db85eb4325ee2f3d>;

/// @title A representation of vehicle assets
contract VehicleType2 is Mintable {
    string public vehicleType; 
    uint public seater; 
    string public skuNumber; 
    string public condition;
    string public brand;
    string public fuel;
    uint public wheels;

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
        string _vehicleType,
        uint _seater,
        string _skuNumber,
        string _condition,
        string _brand,
        string _fuel,
        uint _wheels
    ) public Mintable(_name, _description, _images, _files, _createdDate, _quantity) {
        vehicleType = _vehicleType;
        seater = _seater;
        skuNumber = _skuNumber;
        condition = _condition;
        brand = _brand;
        wheels = _wheels;
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        VehicleType2 newAsset = new VehicleType2(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity,
            vehicleType,
            seater,
            skuNumber,
            condition,
            brand,
            fuel,
            wheels
        );
        return UTXO(address(newAsset));
    }

    // TODO: Finish the update function. 
    function updateVehicle(
        string[] _images, 
        string[] _files, 
        string _vehicleType
    ) public requireOwner("update vehicle") returns (uint) {
        vehicleType = _vehicleType;
        updateAsset(_images, _files);
        return RestStatus.OK;
    }
}
