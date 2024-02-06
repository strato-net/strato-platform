pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of AssetGroup assets
contract AssetGroup is UTXO {
    address[] public assetAddresses;
    uint[] public assetQuantities;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        address[] _assetAddresses,
        uint[] _assetQuantities
    ) public UTXO(_name, _description, _images, _files, _createdDate, 1) {
        assetAddresses = _assetAddresses;
        assetQuantities = _assetQuantities;
    }
    function mint(uint splitQuantity) internal override returns (UTXO) {
        AssetGroup a = new AssetGroup(name, description, images, files, createdDate, assetAddresses, assetQuantities);
        return UTXO(address(a)); 
    }
}

