import "../RestStatus.sol";
import "./MembershipState.sol";
import "../agreement/Agreement.sol";
import "../agreement/AgreementManager.sol";
import "../agreement/AgreementMembership.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../nodes/Node.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../permission/BeanstalkRole.sol";
import "../user/BeanstalkUser.sol";
import "../dapp/Notification.sol";

/**
 * Beanstalk Membership Contract
 *
 * This container holds the data for one membership definition. The Memberships list is managed by the MembershipManager
 *
 * #see MembershipManager
 *
 * #param {address} permissionManager          : address of the permission manager
 * #param {Node} nodeAddress                   : address of the node contract
 * #param {uint} role                          : role that the user is requesting
 * #param {address} userAddress                : address of the beanstalk user contract
 *
 * #return none
 */

contract Membership is RestStatus, MembershipState, BeanstalkRole, BeanstalkErrorCodes {
  BeanstalkPermissionManager permissionManager;
  address public dappAddress;
  address public owner;

  /* Node fields */
  address public nodeAddress;

  string public nodeLabel;
  string public nodeIp;
  string public nodePublicKey;


  /* BeanstalkUser fields */
  address public userAddress;

  string public userId;
  function setUserId( string _userId) {
    require(msg.sender == userAddress, "Membership.setUserId can only be called by the underlying BeanstalkUser contract");
    userId = _userId;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setUserId(userId);
    }
  }

  string public username;

  Notification public notificationPreference;
  function setNotificationPreference( string _notificationPreference) {
    require(msg.sender == userAddress, "Membership.setNotificationPreference can only be called by the underlying BeanstalkUser contract");
    notificationPreference = _notificationPreference;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setNotificationPreference(userId);
    }
  }

  /* Membership fields */
  address public userBlockchainAddress;
  BeanstalkRole public role;
  MembershipState public state;

  mapping (string => uint) agreementSet;
  string[] public userAgreements;
  AgreementManager agreementManager;

  mapping (string => uint) agreementMembershipSet;
  address[] agreementMemberships;

  /**
  * Constructor
  */
  constructor(
    address _dappAddress,
    address _permissionManager,
    address _agreementManager,
    address _nodeAddress,
    address _userAddress,
    address _userBlockchainAddress,
    BeanstalkRole _role
  ) {
    owner = msg.sender;
    dappAddress = _dappAddress;
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    agreementManager = AgreementManager(_agreementManager);

    nodeAddress = _nodeAddress;
    if (nodeAddress != address(0)) {
      Node node = Node(nodeAddress);
      nodeLabel = node.nodeLabel();
      nodeIp = node.nodeIp();
      nodePublicKey = node.nodePublicKey();
    }

    userAddress = _userAddress;
    if (userAddress != address(0)) {
      BeanstalkUser user = BeanstalkUser(userAddress);
      userId = user.userId();
      username = user.username();
      notificationPreference = user.notificationPreference();
    }

    userBlockchainAddress = _userBlockchainAddress;
    role = _role;
    state = MembershipState.REQUESTED;
    BeanstalkUser(userAddress).addMembership(address(this));
  }

  // Update state in Membership FSM
  function setState(MembershipState _state) public returns (uint, BeanstalkErrorCodes, MembershipState) {
    if (!permissionManager.canUpdateMembership(msg.sender)) return (RestStatus.FORBIDDEN, BeanstalkErrorCodes.MEMBERSHIP_INSUFFICIENT_PERMISSION,false);
    // Check whether the user can update the membership
    state = _state;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setMembershipState(state);
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, state);
  }

  // Update role
  function setRole(BeanstalkRole _role) public returns (uint, BeanstalkErrorCodes, BeanstalkRole) {
    if (!permissionManager.canUpdateMembership(msg.sender)) return (RestStatus.FORBIDDEN, BeanstalkErrorCodes.MEMBERSHIP_INSUFFICIENT_PERMISSION,false);
    // Check whether the user can update the membership
    role = _role;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setMembershipRole(role);
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, role);
  }

  // Update role
  function setUserBlockchainAddress(address _userBlockchainAddress) public returns (uint, BeanstalkErrorCodes, address) {
    if (!permissionManager.canUpdateMembership(msg.sender)) return (RestStatus.FORBIDDEN, BeanstalkErrorCodes.MEMBERSHIP_INSUFFICIENT_PERMISSION,false);
    // Check whether the user can update the membership
    userBlockchainAddress = _userBlockchainAddress;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setUserBlockchainAddress(userBlockchainAddress);
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, userBlockchainAddress);
  }

  function addAgreementId(
    string _agreementId
  ) returns (uint, BeanstalkErrorCodes) {
    if (agreementSet[_agreementId] == 0) {
      userAgreements.push(_agreementId);
      agreementSet[_agreementId] = userAgreements.length;
      (uint restStatus, BeanstalkErrorCodes errorCode, address agreement) = agreementManager.get(_agreementId);
      if (restStatus == RestStatus.OK && agreement != address(0)) {
        AgreementMembership agreementMembership = new AgreementMembership(
          dappAddress,
          agreement,
          agreement.agreementId(),
          //agreement.dealerChainId(),
          //agreement.dealerGrowerChainId(),
          //agreement.growerChainId(),
          //agreement.growerProcessorChainId(),
          //agreement.cropYear(),
          //agreement.dealerId(),
          //agreement.growerId(),
          //agreement.processorId(),
          agreement.programId(),
          agreement.programName(),
          //agreement.region(),
          //agreement.season(),
          address(this),
          //nodeLabel,
          //nodeIp,
          //nodePublicKey,
          userId,
          username,
          //notificationPreference,
          userBlockchainAddress,
          role //,
          //state
        );
        agreementMemberships.push(address(agreementMembership));
        agreementMembershipSet[_agreementId] = agreementMemberships.length;
        agreement.addAgreementMembership(address(agreementMembership));
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function removeAgreementId(
    string _agreementId
  ) returns (uint, BeanstalkErrorCodes) {
    if (agreementSet[_agreementId] > 0) {
      uint index = agreementSet[_agreementId];
      agreementSet[_agreementId] = 0;
      userAgreements[index - 1] = "";
    }
    if (agreementMembershipSet[_agreementId] > 0) {
      uint index = agreementMembershipSet[_agreementId];
      agreementMembershipSet[_agreementId] = 0;
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[index - 1]);
      agreementMemberships[index - 1] = address(0);
      if (address(agreementMembership) != address(0)) {
        agreementMembership.clear();
      }
      (uint restStatus, BeanstalkErrorCodes errorCode, address agreement) = agreementManager.get(_agreementId);
      if (agreement != address(0)) {
        agreement.removeAgreementMembership(address(agreementMembership));
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }
}
