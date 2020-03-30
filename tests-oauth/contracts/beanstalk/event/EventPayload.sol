import "../RestStatus.sol";
import "../dapp/BeanstalkErrorCodes.sol";

/**
 * Event Payload container
 *
 * This container holds one payload item for an event.
 *
 * #return none
 */

contract EventPayload {

  address public owner;
  string agreementId;
  string public eventId;
  string public eventUid;
  string public payloadId;
  string public payloadValue;
  uint public index;

  //
  constructor(
    string _agreementId,
    string _eventId,
    string _eventUid,
    string _payloadId,
    string _payloadValue,
    uint _index
  ) {
    owner = msg.sender;
    agreementId = _agreementId;
    eventId = _eventId;
    eventUid = _eventUid;
    payloadId = _payloadId;
    payloadValue = _payloadValue;
    index = _index;
  }

  function updateEventPayload(string _payloadId, string _payloadValue) {
    payloadId = _payloadId;
    payloadValue = _payloadValue;
  }
}
