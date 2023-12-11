import "/dapp/orders/contracts/Sales/MembershipSale.sol";
import "/dapp/mercata-base-contracts/Templates/Assets/SemiFungible.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Membership assets
contract Membership is ItemStatus, PaymentType, SemiFungible {
    uint expirationPeriodInMonths;
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
        uint _expirationPeriodInMonths
    ) SemiFungible(_name, _description, _images, _createdDate, _units, _serialNumber, _status, _price, _owner,_paymentTypes) {
        expirationPeriodInMonths = _expirationPeriodInMonths;
        expirationDate = block.timestamp + (expirationPeriodInMonths*2592000);
        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _units);
        }
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
        PaymentType[] _paymentTypes) internal override returns(address){
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
                expirationPeriodInMonths
                    );
        return address(newAsset);
            // emit AssetSplit(address(newAsset), splitUnitsArray[i]);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public override requireOwner("create sale") returns (uint) {
        // require(block.timestamp < expirationDate, "SemiFungible is expired");
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MembershipSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public override returns (uint, string) {
        // require(block.timestamp < expirationDate, "SemiFungible is expired");
        address newSale = address(new MembershipSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }
}