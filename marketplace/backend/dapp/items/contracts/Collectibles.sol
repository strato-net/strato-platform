pragma es6;
pragma strict;

import <9cd03ab3290710caa85563a82a1c745772901650>;

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
        uint _createdDate,
        uint _quantity,
        string _condition
    ) public Mintable(_name, _description, _images, _files, _createdDate, _quantity) {
        condition = _condition;
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        Collectibles newAsset = new Collectibles(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity,
            condition
        );
        return UTXO(address(newAsset));
    }

    // TODO: Finish the update function. 
    function updateCollectible(
        string[] _images, 
        string[] _files
    ) public requireOwner("update collectible") returns (uint) {
        updateAsset(_images, _files);
        return RestStatus.OK;
    }
}