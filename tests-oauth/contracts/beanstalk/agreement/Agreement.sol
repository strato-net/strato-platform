import "../RestStatus.sol";
import "../agreement/AgreementMembership.sol";
import "../exceptionDef/ExceptionDefManager.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../program/ProgramManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../dapp/PrivateChainType.sol";
import "../dapp/BeanstalkDapp.sol"

/**
 * Agreement container
 *
 * This container holds the data for an agreement.
 *
 * #see AgreementManager
 *
 * #param {string} agreementId : unique agreement ID
 * #param {string[]} chainsIds : users' private chains IDs
 * #param {uint} cropYear : year
 * #param {string} dealerId : unique Dealer ID
 * #param {string} growerId : unique Grower ID
 * #param {string} programName : program name
 * #param {string} region : region
 * #param {string} season : season
 *
 * #return none
 */

contract Agreement is RestStatus, BeanstalkErrorCodes, PrivateChainType {
  address public dappAddress;
  BeanstalkPermissionManager permissionManager;
  ProgramManager programManager;
  ExceptionDefManager exceptionDefManager;

  address public owner;
  string public agreementId;
  string public dealerChainId;
  string public dealerGrowerChainId;
  string public growerChainId;
  string public growerProcessorChainId;
  uint public cropYear;
  string public dealerId;
  string public growerId;
  string public processorId;
  string public programId;
  string public programName;
  string public region;
  string public season;

  mapping (address => uint) agreementMembershipSet;
  address[] agreementMemberships;

  constructor(
    address _dappAddress,
    string _agreementId,
    string[] _chainsIds,
    uint _cropYear,
    string _dealerId,
    string _growerId,
    string _programId,
    string _programName,
    string _region,
    string _season,
    address _permissionManager,
    address _programManager
  ) {
    owner = msg.sender;
    dappAddress = _dappAddress;
    agreementId = _agreementId;
    dealerChainId = _chainsIds[uint(PrivateChainType.dealerChain)];
    dealerGrowerChainId = _chainsIds[uint(PrivateChainType.dealerGrowerChain)];
    growerChainId = _chainsIds[uint(PrivateChainType.growerChain)];
    growerProcessorChainId = _chainsIds[uint(PrivateChainType.growerProcessorChain)];
    cropYear = _cropYear;
    dealerId = _dealerId;
    growerId = _growerId;
    programId = _programId;
    programName = _programName;
    region = _region;
    season = _season;
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    programManager = ProgramManager(_programManager);
    exceptionDefManager = new ExceptionDefManager(_dappAddress, _permissionManager, BeanstalkDapp(_dappAddress).eventDefManager());
  }

  function setDealerId(
    string _dealerId
  ) returns (uint, uint) {
    dealerId = _dealerId;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setDealerId(dealerId);
    }
    return (RestStatus.OK, 0);
  }

  function setGrowerId(
    string _growerId
  ) returns (uint, uint) {
    growerId = _growerId;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setGrowerId(growerId);
    }
    return (RestStatus.OK, 0);
  }

  function setProcessorId(
    string _processorId
  ) returns (uint, uint) {
    processorId = _processorId;
    for (uint i = 0; i < agreementMemberships.length; i++) {
      AgreementMembership agreementMembership = AgreementMembership(agreementMemberships[i]);
      agreementMembership.setProcessorId(processorId);
    }
    return (RestStatus.OK, 0);
  }

  function addAgreementMembership(
    address _agreementMembership
  ) returns (uint, BeanstalkErrorCodes) {
    if (agreementMembershipSet[_agreementMembership] == 0) {
      agreementMemberships.push(_agreementMembership);
      agreementMembershipSet[_agreementMembership] = agreementMemberships.length;
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function removeAgreementMembership(
    address _agreementMembership
  ) returns (uint, BeanstalkErrorCodes) {
    if (agreementMembershipSet[_agreementMembership] > 0) {
      uint index = agreementMembershipSet[_agreementMembership];
      agreementMembershipSet[_agreementMembership] = 0;
      agreementMemberships[index - 1] = "";
    }
  }
}
