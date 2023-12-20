pragma es6;
pragma strict;

import <e5c8511b96a78f9ab8b67d233cc8fc831f6ece36>;

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
        uint _expirationPeriodInMonths
    ) public SemiFungible(_name, _description, _images, _files, _createdDate, _quantity) {
        expirationPeriodInMonths = _expirationPeriodInMonths;
        expirationDate = block.timestamp + (expirationPeriodInMonths*2592000);
    }

    function mint(uint _quantity) internal override returns(UTXO) {
        Membership newAsset = new Membership(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity,
            expirationPeriodInMonths
        );
        return UTXO(address(newAsset));
    }

    function checkCondition() internal override returns (bool){
        bool conditon = block.timestamp <= expirationDate;
        return conditon;
    }
}