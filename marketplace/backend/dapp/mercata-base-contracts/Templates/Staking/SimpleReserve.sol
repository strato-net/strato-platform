pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimpleReserve is Tokens, Reserve{
    constructor(string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService,
        address _assetOracle, 
        string _name, 
        address _assetRootAddress, 
        decimal _unitConversionRate) Tokens(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) Reserve (_assetOracle, _name, _assetRootAddress, _unitConversionRate) public {
    }
}