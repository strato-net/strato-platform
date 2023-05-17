 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of SubCategory assets
contract SubCategory {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public name;
    string public description;
    address public categoryId;
    uint public createdDate;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
            string _name
        ,   string _description
        ,   uint _createdDate
    ) public {
        owner = tx.origin;

        name = _name;
        description = _description;
        categoryId = msg.sender;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(tx.origin);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        string _name
    ,   string _description
    ,uint _scheme
    ) returns (uint) {
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        name = _name;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        description = _description;
      }

      return RestStatus.OK;
    }

    
}


