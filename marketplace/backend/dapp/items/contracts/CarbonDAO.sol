pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of CarbonDAO assets
contract CarbonDAO is SemiFungible {
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService
    ) public SemiFungible(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        CarbonDAO newAsset = new CarbonDAO(
            name,
            description,
            images,
            files,
            fileNames,
            createdDate,
            _quantity,
            status,
            address(redemptionService)
        );
        return UTXO(address(newAsset));
    }
}
