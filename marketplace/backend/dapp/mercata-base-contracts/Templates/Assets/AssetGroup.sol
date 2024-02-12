pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;
import "./Asset.sol";

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

    function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber) internal override {
        for (uint = 0; i < assetAddresses.length; i++) {
            address a = assetAddresses[i];
            Asset asset = Asset(a);
            uint assetQuantity = assetQuantities[i];
            asset.automaticTransfer(_newOwner, assetQuantity, _isUserTransfer, _transferNumber);
        }
    }
}

