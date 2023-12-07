import "/dapp/orders/contracts/Sales/MembershipSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Membership assets
contract Membership is ItemStatus, PaymentType, SemiFungible {
    uint _expirationPeriodInMonths;
    uint expirationDate;
    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        string _serialNumber,
        ItemStatus _status,
        uint _price,
        address _owner,
        PaymentType[] _paymentTypes,
        
    ) SemiFungible(_name, _description, _images, _createdDate, _units, _serialNumber, _status, _price, _owner, _paymentTypes, _expirationPeriodInMonths, uid) {
        expirationPeriodInMonths =_expirationPeriodInMonths;
        expirationDate = block.timestamp + (expirationPeriodInMonths*2592000);
    }

    function mint(string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        string _serialNumber,
        ItemStatus _status,
        uint _price,
        address _owner,
        PaymentType[] _paymentTypes,
        uint _expirationPeriodInMonths,
        uint uid) internal overrides public returns(){
        require(block.timestamp < expirationDate, "Membership is expired");
        Membership newAsset = new Membership(
                _name,
                _description,
                _images,
                _createdDate,
                _units,
                _serialNumber,
                _status,
                _price,
                _owner,
                _paymentTypes,
                _expirationPeriodInMonths
                    );

            newAssets.push(address(newAsset));
            emit AssetSplit(address(newAsset), splitUnitsArray[i]);
    }
}
