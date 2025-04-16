pragma es6;
pragma strict;

import <cbe1614a16d9c75447f40ede6b711e0bb996536b>;

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
        uint _decimals,
        uint _expirationPeriodInMonths,
        AssetStatus _status,
        address _redemptionService
    ) public SemiFungible(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _decimals, _status, _redemptionService) {
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
            decimals,
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