pragma es6;
pragma strict;

import <1d2bdc27fe948a302ced772409305ff42bd76582>;

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