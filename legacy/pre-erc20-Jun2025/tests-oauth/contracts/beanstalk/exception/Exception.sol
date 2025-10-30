import "../RestStatus.sol";
import "../dapp/BeanstalkErrorCodes.sol";

/**
 * Exception container
 *
 * This container holds the data for an exception.
 *
 * #see ExceptionManager
 */

contract record Exception is BeanstalkErrorCodes {

  address public owner;
  string agreementId;
  string eventUid;
  string exceptionId;
  string label;
  uint exceptionTime;
  uint value;
  bool active;

  constructor(
    string _agreementId,
    string _eventUid,
    string _exceptionId,
    string _label,
    uint _exceptionTime,
    uint _value
  ) {
    owner = msg.sender;
    agreementId = _agreementId;
    eventUid = _eventUid;
    exceptionId = _exceptionId;
    label = _label;
    exceptionTime = _exceptionTime;
    value = _value;
    active = true;
  }

  function activate() public returns (uint, BeanstalkErrorCodes) {
    active = true;
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function deactivate() public returns (uint, BeanstalkErrorCodes) {
    active = false;
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }
}
