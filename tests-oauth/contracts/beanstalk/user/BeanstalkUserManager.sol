import "../Hashmap.sol";
import "../RestStatus.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../dapp/Notification.sol";
import "./BeanstalkUser.sol";

/**
* BeanstalkUserManager
*
* Entry point to create new user and access existing users
*
* #see BeanstalkUser
*
* #return none
*/

contract record BeanstalkUserManager is RestStatus, BeanstalkErrorCodes, Notification {
  address dappAddress;
  BeanstalkPermissionManager permissionManager;
  Hashmap usersById;
  Hashmap usersByName;

  /**
  * Constructor
  */
  constructor (address _dappAddress, address _permissionManager, string _userId, string _username) public {
    dappAddress = _dappAddress;
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    usersById = new Hashmap();
    usersByName = new Hashmap();
    createBeanstalkUserInternal(_userId, _username);
  }

  function createBeanstalkUser(
    string _userId,
    string _username
  ) public returns (uint, uint, address) {
    // check permissions
    // if (!permissionManager.canCreateUser(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);
    // exists ?
    return createBeanstalkUserInternal(_userId, _username);
  }

  function createBeanstalkUserInternal(
    string _userId,
    string _username
  ) private returns (uint, uint, address) {
    string defaultUserId = _userId;
    if (defaultUserId == "") defaultUserId = _username;
    if (containsName(_username)) {
      // Update existing
      if (defaultUserId != "") setUserId(_username, defaultUserId);
      return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, usersByName.get(_username));
    } else {
      if (defaultUserId != "" && containsId(defaultUserId)) return (RestStatus.CONFLICT, BeanstalkErrorCodes.BEANSTALK_USER_DUPLICATION, getById(defaultUserId));
      // create new
      BeanstalkUser user = new BeanstalkUser(
        dappAddress,
        defaultUserId,
        _username
      );
      if (defaultUserId != "") usersById.put(defaultUserId, address(user));
      usersByName.put(_username, address(user));
      return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, address(user));
    }
  }

  function setUserId( string _username
                    , string _userId
                    ) returns (uint, uint, address) {
    // check permissions
    // if (!permissionManager.canUpdateUser(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    if (_userId == "") return (RestStatus.BAD_REQUEST, BeanstalkErrorCodes.BEANSTALK_USER_EMPTY_ID, address(0));
    if (containsId(_userId)) return (RestStatus.CONFLICT, BeanstalkErrorCodes.BEANSTALK_USER_DUPLICATION, getById(_userId));

    var (restStatus, beanstalkUserAddress) = getByName(_username);

    if (restStatus != RestStatus.OK) {
      return (restStatus, BeanstalkErrorCodes.BEANSTALK_USER_NOT_FOUND, 0);
    }

    BeanstalkUser beanstalkUser = BeanstalkUser(beanstalkUserAddress);
    string oldId = beanstalkUser.userId();
    var (restStatus, errorCode) = beanstalkUser.setUserId(_userId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    if (oldId != "") {
      usersById.remove(oldId);
    }
    usersById.put(_userId, address(beanstalkUser));

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, beanstalkUser);
  }

  function setNotificationPreference( string _username
                                    , Notification _notificationPreference
                                    ) returns (uint, uint, address) {
    // check permissions
    // if (!permissionManager.canUpdateUser(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    var (restStatus, beanstalkUserAddress) = getByName(_username);

    if (restStatus != RestStatus.OK) {
      return (restStatus, BeanstalkErrorCodes.BEANSTALK_USER_NOT_FOUND, 0);
    }

    BeanstalkUser beanstalkUser = BeanstalkUser(beanstalkUserAddress);
    var (restStatus, errorCode) = beanstalkUser.setNotificationPreference(_notificationPreference);

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, beanstalkUser);
  }

  function addUsersToAgreements(
    string[] _usernames,
    string[] _agreementIds
  ) returns (uint, uint) {
    for (uint i = 0; i < _usernames.length; i++) {
      (uint restStatus, address userAddress) = getByName(_usernames[i]);
      if (restStatus == RestStatus.OK) {
        for (uint j = 0; j < _agreementIds.length; j++) {
          BeanstalkUser(userAddress).addAgreementToMemberships(_agreementIds[j]);
        }
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function removeUsersFromAgreements(
    string[] _usernames,
    string[] _agreementIds
  ) returns (uint, uint) {
    for (uint i = 0; i < _usernames.length; i++) {
      (uint restStatus, address userAddress) = getByName(_usernames[i]);
      if (restStatus == RestStatus.OK) {
        for (uint j = 0; j < _agreementIds.length; j++) {
          BeanstalkUser(userAddress).removeAgreementFromMemberships(_agreementIds[j]);
        }
      }
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function getById(string _userId) public view returns (uint, address) {
    if (!containsId(_userId)) return (RestStatus.NOT_FOUND, 0);
    return (RestStatus.OK, usersById.get(_userId));
  }

  function getByName(string _username) public view returns (uint, address) {
    if (!containsName(_username)) return (RestStatus.NOT_FOUND, 0);
    return (RestStatus.OK, usersByName.get(_username));
  }

  function containsId(string _userId) public view returns (bool) {
    return usersById.contains(_userId);
  }

  function containsName(string _username) public view returns (bool) {
    return usersByName.contains(_username);
  }
}
