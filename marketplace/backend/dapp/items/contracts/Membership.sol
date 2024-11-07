pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

/// @title A representation of Membership assets
contract Membership is SemiFungible {
    uint expirationPeriodInMonths;
    uint expirationDate;
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        uint _expirationPeriodInMonths,
        AssetStatus _status,
        address _redemptionService
    ) public SemiFungible(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {
        expirationPeriodInMonths = _expirationPeriodInMonths;
        expirationDate = block.timestamp + (expirationPeriodInMonths*2592000);
    }

    function mint(uint _quantity) internal override returns(UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        Membership newAsset = new Membership(
            name,
            description,
            images,
            files,
            fileNames,
            createdDate,
            _quantity,
            expirationPeriodInMonths,
            status,
            address(redemptionService)
        );
        return UTXO(address(newAsset));
    }

    function checkCondition() internal override returns (bool){
        bool conditon = block.timestamp <= expirationDate;
        return conditon;
    }
}