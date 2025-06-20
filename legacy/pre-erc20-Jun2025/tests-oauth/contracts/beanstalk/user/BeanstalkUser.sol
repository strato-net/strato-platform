import "../RestStatus.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../dapp/Notification.sol";
import "../membership/Membership.sol";

/**
 * Beanstalk User container
 *
 * This container holds the data for one user. The Users list is managed by the BeanstalkUserManager
 *
 * #see BeanstalkUserManager
 *
 * #param {string} userId : unique user ID
 * #param {string} username : user name/email
 * #param {address} userAddress : user address
 *
 * #return none
 */

contract record BeanstalkUser is RestStatus, BeanstalkErrorCodes, Notification {

  address public owner;
  address public dappAddress;
  string public userId;
  string public username;
  Notification public notificationPreference;

  mapping (address => uint) membershipSet;
  address[] public userMemberships;

  mapping (string => uint) agreementSet;
  string[] public userAgreements;

  constructor(
    address _dappAddress,
    string _userId,
    string _username
  ) {
    owner = msg.sender;
    dappAddress = _dappAddress;
    userId = _userId;
    username = _username;
    notificationPreference = Notification.EMAIL;
  }

  function setUserId(
    string _userId
  ) returns (uint, uint) {
    userId = _userId;
    for (uint i = 0; i < userMemberships.length; i++) {
      if (userMemberships[i] != address(0)) {
        Membership(userMemberships[i]).setUserId(_userId);
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function setNotificationPreference(
    Notification _notificationPreference
  ) returns (uint, uint) {
    notificationPreference = _notificationPreference;
    for (uint i = 0; i < userMemberships.length; i++) {
      if (userMemberships[i] != address(0)) {
          Membership(userMemberships[i]).setNotificationPreference(_notificationPreference);
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function addMembership(
    address _membership
  ) returns (uint, BeanstalkErrorCodes) {
    if (membershipSet[_membership] == 0) {
      userMemberships.push(_membership);
      membershipSet[_membership] = userMemberships.length;
      addAgreementsToMembership(_membership);
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function removeMembership(
    address _membership
  ) returns (uint, BeanstalkErrorCodes) {
    if (membershipSet[_membership] > 0) {
      uint index = membershipSet[_membership];
      membershipSet[_membership] = 0;
      removeAgreementsFromMembership(userMemberships[index - 1]);
      userMemberships[index - 1] = address(0);
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function addAgreementId(
    string _agreementId
  ) returns (uint, BeanstalkErrorCodes) {
    if (agreementSet[_agreementId] == 0) {
      userAgreements.push(_agreementId);
      agreementSet[_agreementId] = userAgreements.length;
      addAgreementToMemberships(_agreementId);
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
      removeAgreementFromMemberships(_agreementId);
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function setAgreementIds(
    string[] _agreementIds
  ) returns (uint, BeanstalkErrorCodes, bool) {
    clearAgreementIds();
    return addAgreementIds(_agreementIds);
  }

  function addAgreementIds(
    string[] _agreementIds
  ) returns (uint, BeanstalkErrorCodes, bool) {
    // validate
    // workaround for BUG in SolidVM
    bytes memory firstElement = bytes(_agreementIds[0]);
    if (_agreementIds.length > 1 || firstElement.length > 0) {
      for (uint i = 0; i < _agreementIds.length; i++) {
        addAgreementId(_agreementIds[i]);
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, true);
  }

  function removeAgreementIds(
    string[] _agreementIds
  ) returns (uint, BeanstalkErrorCodes, bool) {
    // validate
    // workaround for BUG in SolidVM
    bytes memory firstElement = bytes(_agreementIds[0]);
    if (_agreementIds.length > 1 || firstElement.length > 0) {
      for (uint i = 0; i < _agreementIds.length; i++) {
        removeAgreementId(_agreementIds[i]);
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, true);
  }

  function clearAgreementIds(
  ) returns (uint, uint) {
    for (uint i = 0; i < agreementIds.length; i++) {
      string s = agreementIds[i];
      agreementSet[s] = 0;
      if (s != "") {
        removeAgreementFromMemberships(s);
      }
    }
    agreementIds.length = 0;
    return (RestStatus.OK, 0);
  }

  function addAgreementToMemberships(
    string _agreementId
  ) {
    for (uint i = 0; i < userMemberships.length; i++) {
      if (userMemberships[i] != address(0)) {
        Membership membership = Membership(userMemberships[i]);
        membership.addAgreementId(_agreementId);
      }
    }
  }

  function removeAgreementFromMemberships(
    string _agreementId
  ) {
    for (uint i = 0; i < userMemberships.length; i++) {
      if (userMemberships[i] != address(0)) {
        Membership membership = Membership(userMemberships[i]);
        membership.removeAgreementId(_agreementId);
      }
    }
  }

  function addAgreementsToMembership(
    address _membership
  ) {
    if (_membership != address(0)) {
      Membership membership = Membership(_membership);
      for (uint i = 0; i < userAgreements.length; i++) {
        if (userAgreements[i] != "") {
          membership.addAgreementId(userAgreements[i]);
        }
      }
    }
  }

  function removeAgreementsFromMembership(
    address _membership
  ) {
    if (_membership != address(0)) {
      Membership membership = Membership(_membership);
      for (uint i = 0; i < userAgreements.length; i++) {
        if (userAgreements[i] != "") {
          membership.removeAgreementId(userAgreements[i]);
        }
      }
    }
  }
}
