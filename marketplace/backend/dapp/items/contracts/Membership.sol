pragma es6;
pragma strict;

import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

/// @title A representation of Membership assets
contract Membership is SemiFungible {
    uint expirationPeriodInMonths;
    uint expirationDate;
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        string _serialNumber,
        uint _expirationPeriodInMonths
    ) public SemiFungible(_name, _description, _images, _files, _createdDate, _quantity, _serialNumber) {
        expirationPeriodInMonths = _expirationPeriodInMonths;
        expirationDate = block.timestamp + (expirationPeriodInMonths*2592000);
    }

    function mint(uint _quantity) internal override returns(UTXO) {
        require(block.timestamp < expirationDate, "Membership is expired");
        Membership newAsset = new Membership(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity,
            serialNumber,
            expirationPeriodInMonths
        );
        return UTXO(newAsset);
    }
}