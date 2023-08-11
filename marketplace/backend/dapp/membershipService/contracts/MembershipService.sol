
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of MembershipService assets
contract MembershipService {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public membershipId;
    address public serviceId;
    int public membershipPrice;
    int public discountPrice;
    int public maxQuantity;
    int public createdDate;
    bool public isActive;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
            address _membershipId
        ,   address _serviceId
        ,   int _membershipPrice
        ,   int _discountPrice
        ,   int _maxQuantity
        ,   int _createdDate
        ,   bool _isActive
    ) public {
        owner = msg.sender;

        membershipId = _membershipId;
        serviceId = _serviceId;
        membershipPrice = _membershipPrice;
        discountPrice = _discountPrice;
        maxQuantity = _maxQuantity;
        createdDate = _createdDate;
        isActive = _isActive;

        mapping(string => string) ownerCert = getUserCert(msg.sender);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        address _membershipId
    ,   address _serviceId
    ,   int _membershipPrice
    ,   int _discountPrice
    ,   int _maxQuantity
    ,   int _createdDate
    ,   bool _isActive
    ,uint _scheme
    ) returns (uint) {
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        membershipId = _membershipId;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        serviceId = _serviceId;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        membershipPrice = _membershipPrice;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        discountPrice = _discountPrice;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        maxQuantity = _maxQuantity;
      }
      if ((_scheme & (1 << 5)) == (1 << 5)) {
        createdDate = _createdDate;
      }
      if ((_scheme & (1 << 6)) == (1 << 6)) {
        isActive = _isActive;
      }

      return RestStatus.OK;
    }
}
