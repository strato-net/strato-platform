import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permissions/app/contracts/Role.sol";

contract UserMembership_2 is RestStatus, Role{

    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    bool public isAdmin;
    bool public isTradingEntity;
    bool public isCertifier;

    // uint currentPermissionScheme;
    
    address public userAddress;
    // string public username;
    // string public userOrganization;
    
    constructor(
        string _appChainId
        ,   bool _isAdmin
        ,   bool _isTradingEntity
        ,   bool _isCertifier
        ,   address _userAddress
        ,   address _owner
    ) public {
        appChainId = _appChainId;
        owner = _owner;

        isAdmin = _isAdmin;
        isTradingEntity = _isTradingEntity;
        isCertifier = _isCertifier;
        userAddress = _userAddress;

        // mapping(string => string) userCert = getUserCert(_userAddress);
        // username = userCert["commonName"];
        // userOrganization = userCert["organization"];

        mapping(string => string) ownerCert = getUserCert(_userAddress);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
      }

    function update(
        bool _isAdmin
        ,   bool _isTradingEntity
        ,   bool _isCertifier
        ,   uint _scheme
    ) returns (uint) {

      if (msg.sender != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        isAdmin = _isAdmin;
      }

      if ((_scheme & (1 << 1)) == (1 << 1)) {
        isTradingEntity = _isTradingEntity;
      }

      if ((_scheme & (1 << 2)) == (1 << 2)) {
        isCertifier = _isCertifier;
      }

      return RestStatus.OK;
    }


   function getRoles() returns (Role[] memory){

      Role[] _roles=[];

        if(isAdmin){
            _roles.push(Role.ADMIN);
        }
        if(isTradingEntity){
            _roles.push(Role.ADMIN);
        }
        if(isCertifier){
            _roles.push(Role.ADMIN);
        }
        return _roles;
   }

}