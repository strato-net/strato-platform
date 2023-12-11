pragma es6;
pragma strict;

import <1d2bdc27fe948a302ced772409305ff42bd76582>;

/// @title A representation of Membership assets
contract Membership is ItemStatus, PaymentType, SemiFungible {
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
    ) public SemiFungible(_name, _description, "Membership", "Membership", _images, _files, _createdDate, _quantity, _serialNumber) {
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