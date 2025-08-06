import "../RestStatus.sol";
import "../PermissionedHashmap.sol";
import "../Util.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../permission/BeanstalkRole.sol";
import "./MembershipFSM.sol";
import "./Membership.sol";
import "./MembershipEvent.sol";
import "./MembershipState.sol";
import "../agreement/AgreementManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../nodes/NodeManager.sol";
import "../user/BeanstalkUserManager.sol";


/**
* Beanstalk Membership Manager Contract
*
* This contract creates and updates membership requests
*
* #see MembershipState
* #see MembershipEvent
* #see Membership
*
* #return none
*/

contract record MembershipManager is RestStatus, Util, MembershipEvent, MembershipState, BeanstalkRole, BeanstalkErrorCodes {
  address dappAddress;
  BeanstalkPermissionManager permissionManager;
  AgreementManager agreementManager;
  NodeManager nodeManager;
  BeanstalkUserManager userManager;
  MembershipFSM membershipFSM;

  mapping(string => mapping(string => address)) private memberships;

  /**
  * Constructor
  */
  constructor(address _dappAddress, address _permissionManager, address _agreementManager, address _nodeManager, address _userManager, string _username, string _nodeLabel, address _userBlockchainAddress) public {
    dappAddress = _dappAddress;
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    agreementManager = AgreementManager(_agreementManager);
    nodeManager = NodeManager(_nodeManager);
    userManager = BeanstalkUserManager(_userManager);
    membershipFSM = new MembershipFSM();
    (uint nodeRestStatus, address nodeAddress) = nodeManager.getByLabel(_nodeLabel);
    (uint userRestStatus, address userAddress) = userManager.getByName(_username);
    if (nodeRestStatus == RestStatus.OK && userRestStatus == RestStatus.OK && nodeAddress != address(0) && userAddress != address(0)) {
      requestMembership(_username, _nodeLabel, _userBlockchainAddress, BeanstalkRole.TECH_PROVIDER);
      handleMembershipEvent(_username, _nodeLabel, MembershipEvent.APPROVE);
      handleMembershipEvent(_username, _nodeLabel, MembershipEvent.PROCESS);
    }
  }

  // Request membership
  function requestMembership(
    string _username,
    string _nodeLabel,
    address _userBlockchainAddress,
    BeanstalkRole _role
  ) public returns (uint, BeanstalkErrorCodes, address) {
    address alreadyRequested = memberships[_username][_nodeLabel];

    // If request the same membership already requested and is not rejected - return OK.
    // If the previous one is rejected - rewrite it with new one
    if (alreadyRequested != address(0)) {
      if ((uint(Membership(alreadyRequested).role()) == _role) &&
        (Membership(alreadyRequested).state() != MembershipState.REJECTED))
      {
        return (RestStatus.OK, BeanstalkErrorCodes.MEMBERSHIP_DUPLICATION_UNREJECTED, alreadyRequested);
      }
    }

    // If another role for the member already requested and the previous one is accepted - return CONFLICT.
    // If the previous one is new or rejected - rewrite it with new one.
    if ((alreadyRequested != address(0))) {
      if (
        (uint(Membership(alreadyRequested).role()) != _role) &&
        (Membership(alreadyRequested).state() == MembershipState.APPROVED)
      ) {
        return (RestStatus.CONFLICT, BeanstalkErrorCodes.MEMBERSHIP_DUPLICATION_REJECTED, alreadyRequested);
      }
    }

    // If another role for the member already requested and the previous one is accepted - return CONFLICT.
    // If the previous one is new or rejected - rewrite it with new one.
    (uint nodeRestStatus, address nodeAddress) = nodeManager.getByLabel(_nodeLabel);
    if (nodeRestStatus != RestStatus.OK) {
      return (nodeRestStatus, BeanstalkErrorCodes.NODE_NOT_FOUND, address(0));
    }

    // If another role for the member already requested and the previous one is accepted - return CONFLICT.
    // If the previous one is new or rejected - rewrite it with new one.
    (uint userRestStatus, address userAddress) = userManager.getByName(_username);
    if (userRestStatus != RestStatus.OK) {
      return (userRestStatus, BeanstalkErrorCodes.BEANSTALK_USER_NOT_FOUND, address(0));
    }

    address membership = new Membership(dappAddress, address(permissionManager), address(agreementManager), nodeAddress, userAddress, _userBlockchainAddress, _role);

    memberships[_username][_nodeLabel] = address(membership);

    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL,address(membership));
  }

  // Approve or Reject membership
  function handleMembershipEvent(
    string _username,
    string _nodeLabel,
    MembershipEvent _event
  ) public returns (uint, BeanstalkErrorCodes, MembershipState) {
    address membershipAddress = memberships[_username][_nodeLabel];

    Membership membership = Membership(membershipAddress);

    if (address(membership) == 0) return (RestStatus.NOT_FOUND, BeanstalkErrorCodes.MEMBERSHIP_NOT_FOUND, MembershipState.NULL);

    if (_event == MembershipEvent.APPROVE && !permissionManager.canApproveMembership(msg.sender)) {
      return (RestStatus.FORBIDDEN, BeanstalkErrorCodes.UNAUTHORIZED, MembershipState.NULL);
    }

    if (_event == MembershipEvent.REJECT && !permissionManager.canRejectMembership(msg.sender)) {
      return (RestStatus.FORBIDDEN, BeanstalkErrorCodes.UNAUTHORIZED, MembershipState.NULL);
    }

    if ((_event == MembershipEvent.PROCESS || _event == MembershipEvent.ERROR) && !permissionManager.canProcessMembership(msg.sender)) {
      return (RestStatus.FORBIDDEN, BeanstalkErrorCodes.UNAUTHORIZED, MembershipState.NULL);
    }

    MembershipState newState = membershipFSM.handleEvent(membership.state(), _event);

    if (newState == MembershipState.NULL) return (RestStatus.BAD_REQUEST, BeanstalkErrorCodes.MEMBERSHIP_NULL, MembershipState.NULL);

    return membership.setState(newState);
  }

  // Approve or Reject membership
  function rerequestMembership(
    string _username,
    string _nodeLabel,
    BeanstalkRole _role
  ) public returns (uint, BeanstalkErrorCodes, BeanstalkRole) {
    address membershipAddress = memberships[_username][_nodeLabel];
    Membership membership = Membership(membershipAddress);
    if (address(membership) == 0) return (RestStatus.NOT_FOUND, BeanstalkErrorCodes.MEMBERSHIP_NOT_FOUND, MembershipState.NULL);

    (uint rc, uint errorCode, MembershipState newState) = handleMembershipEvent(_username, _nodeLabel, MembershipEvent.REREQUEST);
    if (rc != RestStatus.OK) return (rc, errorCode, membership.role());

    return membership.setRole(_role);
  }

  // Approve or Reject membership
  function setUserBlockchainAddress(
    string _username,
    string _nodeLabel,
    address _userBlockchainAddress
  ) public returns (uint, BeanstalkErrorCodes, address) {
    address membershipAddress = memberships[_username][_nodeLabel];
    Membership membership = Membership(membershipAddress);
    if (address(membership) == 0) return (RestStatus.NOT_FOUND, BeanstalkErrorCodes.MEMBERSHIP_NOT_FOUND, MembershipState.NULL);
    return membership.setUserBlockchainAddress(_userBlockchainAddress);
  }
}
