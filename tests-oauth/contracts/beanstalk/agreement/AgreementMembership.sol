import "../dapp/Notification.sol";
import "../membership/MembershipState.sol";
import "../permission/BeanstalkRole.sol";

contract AgreementMembership is Notification, BeanstalkRole, MembershipState {

  address public owner;
  address public dappAddress;

  /* Agreement fields */
  address agreementAddress;
  string agreementId;
  string dealerChainId;
  string dealerGrowerChainId;
  string growerChainId;
  string growerProcessorChainId;
  uint cropYear;
  string dealerId;
  function setDealerId(string _dealerId) {
    require(msg.sender == agreementAddress, "AgreementMembership.setDealerId can only be called by the underlying Agreement contract");
    dealerId = _dealerId;
  }

  string growerId;
  function setGrowerId(string _growerId) {
    require(msg.sender == agreementAddress, "AgreementMembership.setGrowerId can only be called by the underlying Agreement contract");
    growerId = _growerId;
  }

  string processorId;
  function setProcessorId(string _processorId) {
    require(msg.sender == agreementAddress, "AgreementMembership.setProcessorId can only be called by the underlying Agreement contract");
    processorId = _processorId;
  }

  string programId;
  string programName;
  string region;
  string season;

  /* Membership fields */
  address public membershipAddress;

  string public nodeLabel;
  string public nodeIp;
  string public nodePublicKey;

  string public userId;
  function setUserId( string _userId) {
    require(msg.sender == membershipAddress, "AgreementMembership.setUserId can only be called by the underlying Membership contract");
    userId = _userId;
  }

  string public username;

  Notification public notificationPreference;
  function setNotificationPreference(string _notificationPreference) {
    require(msg.sender == membershipAddress, "AgreementMembership.setNotificationPreference can only be called by the underlying Membership contract");
    notificationPreference = _notificationPreference;
  }

  address public userBlockchainAddress;
  function setUserBlockchainAddress(address _userBlockchainAddress) {
    require(msg.sender == membershipAddress, "AgreementMembership.setMembershipRole can only be called by the underlying Membership contract");
    userBlockchainAddress = _userBlockchainAddress;
  }

  BeanstalkRole public role;
  function setMembershipRole(BeanstalkRole _role) {
    require(msg.sender == membershipAddress, "AgreementMembership.setMembershipRole can only be called by the underlying Membership contract");
    role = _role;
  }

  MembershipState public state;
  function setMembershipState(string _state) {
    require(msg.sender == membershipAddress, "AgreementMembership.setMembershipState can only be called by the underlying Membership contract");
    state = _state;
  }

  constructor(
    address _dappAddress,
    address _agreementAddress,
    string _agreementId,
    //string _dealerChainId,
    //string _dealerGrowerChainId,
    //string _growerChainId,
    //string _growerProcessorChainId,
    //uint _cropYear,
    //string _dealerId,
    //string _growerId,
    //string _processorId,
    string _programId,
    string _programName,
    //string _region,
    //string _season,
    address _membershipAddress,
    //string _nodeLabel,
    //string _nodeIp,
    //string _nodePublicKey,
    string _userId,
    string _username,
    //Notification _notificationPreference,
    address _userBlockchainAddress,
    BeanstalkRole _role //,
    //MembershipState _state
  ) {
    owner = msg.sender;
    dappAddress = _dappAddress;
    agreementAddress = _agreementAddress;
    agreementId = _agreementId;
    //dealerChainId = _dealerChainId;
    //dealerGrowerChainId = _dealerGrowerChainId;
    //growerChainId = _growerChainId;
    //growerProcessorChainId = _growerProcessorChainId;
    //cropYear = _cropYear;
    //dealerId = _dealerId;
    //growerId = _growerId;
    //processorId = _processorId;
    programId = _programId;
    programName = _programName;
    //region = _region;
    //season = _season;
    membershipAddress = _membershipAddress;
    //nodeLabel = _nodeLabel;
    //nodeIp = _nodeIp;
    //nodePublicKey = _nodePublicKey;
    userId = _userId;
    username = _username;
    //notificationPreference = _notificationPreference;
    userBlockchainAddress = _userBlockchainAddress;
    role = _role;
    //state = _state;
  }

  function clear() {
    require(msg.sender == membershipAddress, "AgreementMembership.clear can only be called by the underlying Membership contract");
    owner = address(0);
    dappAddress = address(0);
    agreementAddress = address(0);
    agreementId = "";
    dealerChainId = "";
    dealerGrowerChainId = "";
    growerChainId = "";
    growerProcessorChainId = "";
    cropYear = 0;
    dealerId = "";
    growerId = "";
    processorId = "";
    programId = "";
    programName = "";
    region = "";
    season = "";
    membershipAddress = address(0);
    nodeLabel = "";
    nodeIp = "";
    nodePublicKey = "";
    userId = "";
    username = "";
    notificationPreference = Notification.NONE;
    userBlockchainAddress = address(0);
    role = BeanstalkRole.NULL;
    state = MembershipState.NULL;
  }
}
