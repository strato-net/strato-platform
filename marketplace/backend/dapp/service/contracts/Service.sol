
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of Service assets
contract Service_10 {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public name;
    string public description;
    int public price;
    int public createdDate;


    constructor(
            string _name
        ,   string _description
        ,   int _price
        ,   int _createdDate
    ) public {
        owner = tx.origin;

        name = _name;
        description = _description;
        price = _price;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(tx.origin);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        string _name
    ,   string _description
    ,   int _price
    ,   int _scheme
    ) returns (uint) {
      if(ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        name = _name;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        description = _description;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        price = _price;
      }

      return RestStatus.OK;
    }
    
    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
      mapping(string => string) ownerCert = getUserCert(caller);
      string userOrganization = ownerCert["organization"];
      return userOrganization;
    }
}
