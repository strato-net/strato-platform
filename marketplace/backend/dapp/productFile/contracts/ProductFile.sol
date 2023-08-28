
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "./ProductFileSection.sol";
import "./ProductFileType.sol";


/// @title A representation of ProductFile assets
contract ProductFile is ProductFileSection, ProductFileType {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public productId;
    string public fileLocation;
    string public fileHash;
    string public fileName;
    int public uploadDate;
    uint public createdDate;
    ProductFileSection public currentSection;
    ProductFileType public currentType;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
            address _productId
        ,   string _fileLocation
        ,   string _fileHash
        ,   string _fileName
        ,   int _uploadDate
        ,   uint _createdDate
        ,   ProductFileSection _section
        ,   ProductFileType _type
    ) public {
        owner = tx.origin;

        productId = _productId;
        fileLocation = _fileLocation;
        fileHash = _fileHash;
        fileName = _fileName;
        uploadDate = _uploadDate;
        createdDate = _createdDate;
        currentSection = _section;
        currentType = _type;

        mapping(string => string) ownerCert = getUserCert(tx.origin);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
          string _fileLocation
      ,   string _fileHash
      ,   string _fileName
      ,   int _uploadDate
      ,   ProductFileSection _section
      ,   ProductFileType _type
      ,   uint _scheme
    ) returns (uint) {
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        fileLocation = _fileLocation;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        fileHash = _fileHash;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        fileName = _fileName;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        uploadDate = _uploadDate;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        changeSection(_section);
      }
      if ((_scheme & (1 << 5)) == (1 << 5)) {
        changeType(_type);
      }

      return RestStatus.OK;
    }
  
    function changeType(ProductFileType newType) public {
      if(newType == ProductFileType.IMAGE || newType == ProductFileType.DOCUMENT){ // Add more here in the future
        currentType = newType;
      }
    }
    function changeSection(ProductFileSection newSection) public {
      if(newSection == ProductFileSection.PRODUCTDETAIL){ // Add more here in the future
        currentSection = newSection;
      }
    }
}
