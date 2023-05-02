import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permissions/app/contracts/Role.sol";

import "/dapp/userMemberships/contracts/UserMembershipStateEnum.sol";


contract UserMembershipRequest is Role,UserMembershipStateEnum{
    
    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public userAddress;
    UserMembershipState public state;
    Role public role;
    uint public createdDate;
    address public userMembershipAddress;


    constructor(
        string _appChainId
        ,   address _userAddress
        ,   UserMembershipState _state
        ,   Role _role
        ,   uint _createdDate
        ,   address _userMembershipAddress
        ,   address _owner
    ) public {
        appChainId = _appChainId;
        userAddress = _userAddress;
        state = _state;
        role = _role;
        createdDate = _createdDate;
        userMembershipAddress = _userMembershipAddress;
        owner = _owner;

        mapping(string => string) ownerCert = getUserCert(userAddress);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function setState(UserMembershipState _state) public returns(uint){
        if (owner != msg.sender) return RestStatus.FORBIDDEN;

        state = _state;
        return RestStatus.OK;
    }

    function getUserRole() returns(uint, bool, bool, bool, uint){

        uint scheme=0;
        uint base = 1;
        bool isAdmin = false;
        bool isTradingEntity = false;
        bool isCertifier = false;

        if(state == UserMembershipState.NEW || state == UserMembershipState.REJECTED){
            return ( RestStatus.FORBIDDEN, isAdmin, isTradingEntity, isCertifier, scheme);
        }

        if(role == Role.ADMIN && state == UserMembershipState.ACCEPTED){
            scheme = scheme | (base << 0);
            isAdmin = true;
        }
        if(role == Role.TRADINGENTITY && state == UserMembershipState.ACCEPTED){
            scheme = scheme | (base << 1);
            isTradingEntity = true;
        }
        if(role == Role.CERTIFIER && state == UserMembershipState.ACCEPTED){
            scheme = scheme | (base << 2);
            isCertifier = true;
        }

        return ( RestStatus.OK, isAdmin, isTradingEntity, isCertifier, scheme);
    }

}

