 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of UserAddress assets
contract UserAddress is RestStatus {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public shippingName;
    string public shippingZipcode;
    string public shippingState;
    string public shippingCity;
    string public shippingAddressLine1;
    string public shippingAddressLine2;
    string public billingName;
    string public billingZipcode;
    string public billingState;
    string public billingCity;
    string public billingAddressLine1;
    string public billingAddressLine2;
    uint public createdDate;


    /// @dev UserAddress to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
            string _shippingName
        ,   string _shippingZipcode
        ,   string _shippingState
        ,   string _shippingCity
        ,   string _shippingAddressLine1
        ,   string _shippingAddressLine2
        ,   string _billingName
        ,   string _billingZipcode
        ,   string _billingState
        ,   string _billingCity
        ,   string _billingAddressLine1
        ,   string _billingAddressLine2
        ,   uint _createdDate
    ) public {
        owner = tx.origin;

        shippingName = _shippingName;
        shippingZipcode = _shippingZipcode;
        shippingState = _shippingState;
        shippingCity = _shippingCity;
        shippingAddressLine1 = _shippingAddressLine1;
        shippingAddressLine2 = _shippingAddressLine2;
        billingName = _billingName;
        billingZipcode = _billingZipcode;
        billingState = _billingState;
        billingCity = _billingCity;
        billingAddressLine1 = _billingAddressLine1;
        billingAddressLine2 = _billingAddressLine2;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }
}
