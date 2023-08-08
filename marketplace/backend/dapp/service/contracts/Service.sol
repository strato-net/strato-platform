
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of Service assets
contract Service {

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
        owner = msg.sender;

        name = _name;
        description = _description;
        price = _price;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(msg.sender);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        string _name
    ,   string _description
    ,   int _price
    ,   int _createdDate
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
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        price = _price;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        createdDate = _createdDate;
      }

      return RestStatus.OK;
    }
}
