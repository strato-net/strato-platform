import "../Hashmap.sol";
import "../RestStatus.sol";
import "../Util.sol";
import "./Agreement.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../program/Program.sol";
import "../program/ProgramManager.sol";
import "../user/BeanstalkUserManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";

/**
* Agreement Manager
*
* Entry point to create new agreement, access and update existing agreement by agreementId
*
* #see Agreement
*
* #return none
*/

contract AgreementManager is RestStatus, BeanstalkErrorCodes {
  address public dappAddress;
  BeanstalkPermissionManager permissionManager;
  BeanstalkUserManager userManager;
  ProgramManager programManager;
  Hashmap agreements;

  /**
  * Constructor
  */
  constructor (address _dappAddress, address _permissionManager, address _userManager, address _programManager) public {
    dappAddress = _dappAddress;
    agreements = new Hashmap();
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    userManager = BeanstalkUserManager(_userManager);
    programManager = ProgramManager(_programManager);
  }

  function createAgreement(
    string _agreementId,
    string[] _chainsIds,
    uint _cropYear,
    string _dealerId,
    string _growerId,
    string _programId,
    string _region,
    string _season
  ) public returns (uint, BeanstalkErrorCodes, address) {
    // check permissions
    if (!permissionManager.canCreateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);
    // exists ?
    if (contains(_agreementId)) return (RestStatus.CONFLICT, BeanstalkErrorCodes.AGREEMENT_DUPLICATION, get(_agreementId));
    (uint restStatus, uint errorCode, address programAddress) = programManager.get(_programId);
    if (restStatus != RestStatus.OK) return (restStatus, errorCode, address(0));
    string programName = Program(programAddress).programName();
    // create new
    Agreement agreement = new Agreement(
      dappAddress,
      _agreementId,
      _chainsIds,
      _cropYear,
      _dealerId,
      _growerId,
      _programId,
      programName,
      _region,
      _season,
      address(permissionManager),
      address(programManager)
    );
    agreements.put(_agreementId, address(agreement));
    // created
    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, agreement);
  }

  function setAgreementComplianceManagersIds(
    string _agreementId,
    string[] _complianceManagersIds
  ) public returns (uint, BeanstalkErrorCodes, address) {
    // check permissions
    if (!permissionManager.canUpdateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    (uint restStatus, uint errorCode, address agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, BeanstalkErrorCodes.AGREEMENT_NOT_FOUND, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    (uint complianceManagersRestStatus, uint complianceManagersErrorCode, bool isComplianceIdSet) = agreement.setComplianceManagersIds(_complianceManagersIds);

    if (complianceManagersRestStatus != RestStatus.OK) {
      return (complianceManagersRestStatus, BeanstalkErrorCodes.AGREEMENT_SET_COMPLIANCE_IDS_FAILED, 0);
    }

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, agreement);
  }

  function addAgreementComplianceManagersIds(
    string _agreementId,
    string[] _addComplianceManagersIds
  ) public returns (uint, BeanstalkErrorCodes, address) {
    // check permissions
    if (!permissionManager.canUpdateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    (uint restStatus, uint errorCode, address agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, BeanstalkErrorCodes.AGREEMENT_NOT_FOUND, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    (uint complianceManagersRestStatus, uint complianceManagersErrorCode, bool isComplianceIdSet) = agreement.addComplianceManagersIds(_addComplianceManagersIds);

    if (complianceManagersRestStatus != RestStatus.OK) {
      return (complianceManagersRestStatus, BeanstalkErrorCodes.AGREEMENT_SET_COMPLIANCE_IDS_FAILED, 0);
    }

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, agreement);
  }

  function removeAgreementComplianceManagersIds(
    string _agreementId,
    string[] _removeComplianceManagersIds
  ) public returns (uint, BeanstalkErrorCodes, address) {
    // check permissions
    if (!permissionManager.canUpdateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    (uint restStatus, uint errorCode, address agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, BeanstalkErrorCodes.AGREEMENT_NOT_FOUND, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    (uint complianceManagersRestStatus, uint complianceManagersErrorCode, bool isComplianceIdSet) = agreement.removeComplianceManagersIds(_removeComplianceManagersIds);

    if (complianceManagersRestStatus != RestStatus.OK) {
      return (complianceManagersRestStatus, BeanstalkErrorCodes.AGREEMENT_SET_COMPLIANCE_IDS_FAILED, 0);
    }

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, agreement);
  }

  function clearAgreementComplianceManagersIds(
    string _agreementId
  ) public returns (uint, uint, address) {
    // check permissions
    if (!permissionManager.canUpdateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    var (restStatus, getAgreementError, agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, getAgreementError, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    var (restStatus, errorCode) = agreement.clearComplianceManagersIds();

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    return (RestStatus.OK, 0, agreement);
  }

  function setAgreementDealerId(
    string _agreementId,
    string _dealerId
  ) public returns (uint, uint, address) {
    // check permissions
    if (!permissionManager.canUpdateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    var (restStatus, getAgreementError, agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, getAgreementError, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    var (restStatus, errorCode) = agreement.setDealerId(_dealerId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    return (RestStatus.OK, 0, agreement);
  }

  function setAgreementGrowerId(
    string _agreementId,
    string _growerId
  ) public returns (uint, uint, address) {
    // check permissions
    if (!permissionManager.canUpdateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    var (restStatus, getAgreementError, agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, getAgreementError, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    var (restStatus, errorCode) = agreement.setGrowerId(_growerId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    return (RestStatus.OK, 0, agreement);
  }

  function setAgreementProcessorId(
    string _agreementId,
    string _processorId
  ) public returns (uint, uint, address) {
    // check permissions
    if (!permissionManager.canUpdateAgreement(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    var (restStatus, getAgreementError, agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, getAgreementError, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    var (restStatus, errorCode) = agreement.setProcessorId(_processorId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    return (RestStatus.OK, 0, agreement);
  }

  function getNextEventsNonce(
    string _agreementId
  ) public returns (uint, uint, uint) {

    var (restStatus, getAgreementError, agreementAddress) = get(_agreementId);

    if (restStatus != RestStatus.OK) {
      return (restStatus, getAgreementError, 0);
    }

    Agreement agreement = Agreement(agreementAddress);
    var (restStatus, errorCode, nonce) = agreement.incrementEventsNonce();

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, nonce);
  }

  function get(string _agreementId) public view returns (uint, BeanstalkErrorCodes, address) {
    if (!contains(_agreementId)) return (RestStatus.NOT_FOUND, BeanstalkErrorCodes.AGREEMENT_NOT_FOUND, 0);
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, agreements.get(_agreementId));
  }

  function getUserAddressById(string _userId) public returns (uint, BeanstalkErrorCodes, address) {
    (uint userRestStatus, address userAddress) = userManager.getById(_userId);
    if (userRestStatus != RestStatus.OK) {
      return (userRestStatus, BeanstalkErrorCodes.BEANSTALK_USER_NOT_FOUND, address(0));
    }
    return (userRestStatus, BeanstalkErrorCodes.NULL, userAddress);
  }

  function getUserAddressByName(string _username) public returns (uint, BeanstalkErrorCodes, address) {
    (uint userRestStatus, address userAddress) = userManager.getByName(_username);
    if (userRestStatus != RestStatus.OK) {
      return (userRestStatus, BeanstalkErrorCodes.BEANSTALK_USER_NOT_FOUND, address(0));
    }
    return (userRestStatus, BeanstalkErrorCodes.NULL, userAddress);
  }

  function contains(string _agreementId) public view returns (bool) {
    return agreements.contains(_agreementId);
  }
}
