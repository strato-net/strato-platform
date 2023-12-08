import "/dapp/orders/contracts/Sales/CarbonDAOSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Membership assets
contract CarbonDAO is SemiFungible {
    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        string _membershipNumber,
        ItemStatus _status,
        uint _price,
        address _owner,
        PaymentType[] _paymentTypes,   
    ) SemiFungible(_name, _description, _images, _createdDate, _units, _membershipNumber, _status, _price, _owner, _paymentTypes) {}

    function mint(string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        string _membershipNumber,
        ItemStatus _status,
        uint _price,
        address _owner,
        PaymentType[] _paymentTypes,
        ) internal override public returns(address){
        
        CarbonDAO newAsset = new CarbonDAO(
                                _name,
                                _description,
                                _images,
                                _createdDate,
                                _units,
                                _membershipNumber,
                                _status,
                                _price,
                                _owner,
                                _paymentTypes);
        return address(newAsset);
        // newAssets.push(address(newAsset));
        // emit AssetSplit(address(newAsset), splitUnitsArray[i]);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public override requireOwner("create sale") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new CarbonDAOSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public override returns (uint, string) {
        address newSale = address(new CarbonDAOSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }
}
