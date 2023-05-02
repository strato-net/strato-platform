import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of RawMaterial
contract RawMaterial_3 {

    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public itemSerialNumber;
    string public rawMaterialSerialNumber;
    string public rawMaterialProductName;
    uint public itemUniqueProductCode;
    string public rawMaterialProductId;
    uint public createdDate;


    constructor(
            string _appChainId
        ,   string _itemSerialNumber
        ,   string _rawMaterialSerialNumber
        ,   string _rawMaterialProductName
        ,   uint _itemUniqueProductCode
        ,   string _rawMaterialProductId
        ,   uint _createdDate
    ) public {
        owner = tx.origin;
        appChainId = _appChainId;
        
        itemSerialNumber = _itemSerialNumber;
        rawMaterialSerialNumber = _rawMaterialSerialNumber;
        rawMaterialProductName = _rawMaterialProductName;
        itemUniqueProductCode = _itemUniqueProductCode;
        rawMaterialProductId = _rawMaterialProductId;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }
}
