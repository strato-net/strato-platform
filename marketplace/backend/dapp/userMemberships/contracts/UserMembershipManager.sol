import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permissions/app/contracts/Role.sol";
import "/dapp/userMemberships/contracts/UserMembership.sol";
import "/dapp/userMemberships/contracts/UserMembershipStateEnum.sol";
import "/dapp/userMemberships/contracts/UserMembershipEventEnum.sol";
import "/dapp/userMemberships/contracts/UserMembershipRequest.sol";
import "/dapp/userMemberships/contracts/UserMembershipFSM.sol";

contract UserMembershipManager is 
    RestStatus,
    Role,
    UserMembershipStateEnum,
    UserMembershipEventEnum
{

    UserMembershipFSM public userMembershipFSM;
    // AppPermissionManager public appPermissionManager;
    mapping(address => address) public userMemberships;

    constructor(address _permissionManager) public {
    //  appPermissionManager = AppPermissionManager(_permissionManager);
     userMembershipFSM = new UserMembershipFSM();
    }

    function createUserMembershipAndPermissions(bool _isAdmin, bool _isTradingEntity, bool _isCertifier, address _userAddress) returns (uint){

        mapping(string => string) userCert = getUserCert(_userAddress);
        string userOrganization = userCert["organization"];
        mapping(string => string) ownerCert = getUserCert(_userAddress);
        string ownerOrganization = ownerCert["organization"];

        // TODO check if the user calling the function has admin role
        if(userOrganization != ownerOrganization){
            return (RestStatus.FORBIDDEN);
        }
       
        (uint restStatus, address _userMembership) = createUserMembership(_isAdmin, _isTradingEntity, _isCertifier, _userAddress);
        
        if(restStatus != uint(RestStatus.CREATED)){
            return (RestStatus.BAD_REQUEST);
        }
        UserMembership_2 userMembership = UserMembership_2(_userMembership);
         // TODO AppPermissionManager implementation
        // var(grantRoleStatus, ) = appPermissionManager.upsertRole('AppChain', userMembership.userAddress(), userMembership.getRoles());
        
        return (grantRoleStatus);
    }

    function _createUserMembershipRequest(address _userAddress, UserMembershipState _state, Role _role, uint _createdDate, address _userMembershipAddress, address _owner) public returns(uint, address){

       UserMembershipRequest userMembershipRequest = new UserMembershipRequest(_userAddress, _state, _role, _createdDate, _userMembershipAddress, _owner);
       return (RestStatus.CREATED, address(userMembershipRequest));
    }

    function createUserMembershipRequest(address _userAddress, Role[] _roles, uint _createdDate, address _userMembershipAddress) public returns(uint, address[]){
        address[] userMembershipRequests;

        for(uint i=0;i<_roles.length;i++){
        (,address _userMembershipRequest)=_createUserMembershipRequest(_userAddress, UserMembershipState.NEW, _roles[i], _createdDate, _userMembershipAddress, address(this));
            userMembershipRequests.push(_userMembershipRequest);
        }

        return (RestStatus.CREATED,userMembershipRequests);
    }

    function updateUserMembershipRequest(address _userMembershipRequestAddress, UserMembershipEvent _userMembershipEvent) public returns(uint, UserMembershipState){
      
        UserMembershipRequest userMembershipRequest = UserMembershipRequest(_userMembershipRequestAddress);
        
        if (address(userMembershipRequest) == address(0)){
            return (RestStatus.NOT_FOUND, UserMembershipState.NULL);
        }
        
        UserMembershipState newState = userMembershipFSM.handleEvent(userMembershipRequest.state(), _userMembershipEvent);

        if(_userMembershipEvent == UserMembershipEvent.REJECT){
            uint256 restStatusState = userMembershipRequest.setState(newState);
            return (restStatusState, newState);
        }

        uint256 restStatusState = userMembershipRequest.setState(newState);

        (uint status, bool isAdmin, bool isTradingEntity, bool isCertifier, uint scheme)= userMembershipRequest.getUserRole();   

        (uint membershipUpdateStatus) = updateUserMembership(userMembershipRequest.userMembershipAddress(), isAdmin, isTradingEntity, isCertifier, scheme);

        return (restStatusState, newState);
    }

    function _createUserMembership(bool _isAdmin, bool _isTradingEntity, bool _isCertifier, address _userAddress, address _owner) public returns(uint, address){
        // Check if user already has a membership   
        if (userMemberships[_userAddress] != address(0)) {
            return (RestStatus.CONFLICT, address(0));
        }  
        //  if(!appPermissionManager.canCreateUserMembership(tx.origin)){
        //     return (RestStatus.UNAUTHORIZED,address(0));
        // }
        UserMembership_2 userMembership = new UserMembership_2(_isAdmin, _isTradingEntity, _isCertifier, _userAddress, _owner);
        // Store the new membership in the mapping
        userMemberships[_userAddress] = address(userMembership);
        
        return (RestStatus.CREATED, address(userMembership));
    }

    function createUserMembership(bool _isAdmin, bool _isTradingEntity, bool _isCertifier, address _userAddress) public returns(uint, address){

        (uint restStatus, address userMembership) = _createUserMembership(_isAdmin, _isTradingEntity, _isCertifier, _userAddress, address(this));
        
        return (restStatus, userMembership); 
    }


    function updateUserMembership(address _userMembership, bool _isAdmin, bool _isTradingEntity, bool _isCertifier, uint _scheme) public returns(uint){
        
        //  if(!appPermissionManager.canUpdateUserMembership(tx.origin)){
        //     return (RestStatus.UNAUTHORIZED,address(0));
        // }

        UserMembership_2 userMembership = UserMembership_2(_userMembership);
        uint status = userMembership.update(_isAdmin, _isTradingEntity, _isCertifier, _scheme);

        // TODO AppPermissionManager implementation
        // var(grantRoleStatus, ) = appPermissionManager.upsertRole('AppChain', userMembership.userAddress(), userMembership.getRoles());
        
        // if(grantRoleStatus != uint(RestStatus.OK)){
        //     return (grantRoleStatus);
        // }  
        
        if(status != uint(RestStatus.OK)){
            return (RestStatus.BAD_REQUEST);
        }
        return (RestStatus.OK);
   }

}