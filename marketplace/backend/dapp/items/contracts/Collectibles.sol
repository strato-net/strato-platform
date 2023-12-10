pragma es6;
pragma strict;

import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

/// @title A representation of Collectible assets
contract Collectibles is Mintable {
    string public serialNumber;
    string public condition;
    uint public units;

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
        string _condition
    ) public Mintable(_name, _description, "Membership", "Membership", _images, _files, _createdDate, _quantity) {
        serialNumber = _serialNumber;
        condition = _condition;
    }

    // TODO: Finish the update function. 
    function updateCollectible(
        string[] _images, 
        string[] _files, 
        string _serialNumber,
    ) public requireOwner("update collectible") returns (uint) {
        serialNumber = _serialNumber;
        updateAsset(_images, _files);
        return RestStatus.OK;
    }
}