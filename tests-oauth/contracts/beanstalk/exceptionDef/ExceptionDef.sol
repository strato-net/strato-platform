import "./ExceptionType.sol";
import "../dapp/PrivateChainType.sol";
import "../dapp/BeanstalkErrorCodes.sol";

/**
 * Exception Definition container
 *
 * This container holds the data for an exception definition.
 *
 * #see ExceptionDefManager
 */

contract ExceptionDef is ExceptionType, PrivateChainType, BeanstalkErrorCodes {

  address public dappAddress;
  address public owner;
  address permissionManager;

  string exceptionId;
  ExceptionType exceptionType;
  string eventId;
  string programId;
  string programName;
  uint minValue;
  uint maxValue;
  uint timeout;
  string template;
  PrivateChainType chainType;

  bool enabled;

  constructor(
    address _dappAddress,
    string _exceptionId,
    address _permissionManager,
    string _eventId,
    string _programId,
    string _programName,
    ExceptionType _exceptionType,
    uint _minValue,
    uint _maxValue,
    uint _timeout,
    string _template,
    PrivateChainType _chainType,
    bool _enabled
  ) {
    dappAddress = _dappAddress;
    owner = msg.sender;
    permissionManager = _permissionManager;
    exceptionId = _exceptionId;
    eventId = _eventId;
    programId = _programId;
    programName = _programName;
    exceptionType = _exceptionType;
    minValue = _minValue;
    maxValue = _maxValue;
    timeout = _timeout;
    template = _template;
    chainType = _chainType;

    enabled = _enabled;
  }

  function update(
    ExceptionType _exceptionType,
    uint _minValue,
    uint _maxValue,
    uint _timeout,
    string _template,
    PrivateChainType _chainType,
    bool _enabled
  ) public returns (uint, uint, address) {

    if (!permissionManager.canUpdateExceptionDef(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    exceptionType = _exceptionType;
    minValue = _minValue;
    maxValue = _maxValue;
    timeout = _timeout;
    template = _template;
    chainType = _chainType;

    enabled = _enabled;

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, address(this));
  }


}
