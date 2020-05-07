import "../RestStatus.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../event/EventPayload.sol";

/**
 * Event container
 *
 * This container holds the data for an event.
 * NOTE: flattening the array data
 * Since search doesnt return array data in the results, we flatten the array members into member variables
 * these are returned in the search results, and can also be used to query events for
 *
 * #see EventManager
 *
 * #param {string} agreementId : unique event ID
 * #param {string} eventCategory : event category from event definition
 * #param {string} eventId : event ID
 * #param {string} eventUid : event unique ID
 * #param {string} order : event order from event definition
 * #param {string[]} payloadIds : array of event payload IDs
 * #param {string[]} payloadValues : array of event payload values
 * #param {string} source : event source from event definition
 * #param {uint} timestamp : event timestamp, Unix time
 * #param {uint} nonce : event nonce
 *
 * #return none
 */

contract Event is RestStatus, BeanstalkErrorCodes {

  address public owner;
  string agreementId;
  string eventCategory;
  string eventId;
  string eventUid;
  string order;
  string[] public payloadIds;
  string[] public payloadValues;
  EventPayload[] eventPayloads;
  string source;
  uint timestamp;
  uint nonce;

  // flatten payloadIds and payloadValues
  string public key0;
  string public key1;
  string public key2;
  string public key3;
  string public key4;
  string public key5;
  string public key6;
  string public key7;
  string public key8;
  string public key9;

  string public value0;
  string public value1;
  string public value2;
  string public value3;
  string public value4;
  string public value5;
  string public value6;
  string public value7;
  string public value8;
  string public value9;

  //
  constructor(
    string _agreementId,
    string _eventCategory,
    string _eventId,
    string _eventUid,
    string _order,
    string[] _payloadIds,
    string[] _payloadValues,
    string _source,
    uint _timestamp,
    uint _nonce
  ) {
    owner = msg.sender;
    agreementId = _agreementId;
    eventCategory = _eventCategory;
    eventId = _eventId;
    eventUid = _eventUid;
    order = _order;
    source = _source;
    // flatten
    flatten(_payloadIds, _payloadValues);
    timestamp = _timestamp;
    nonce = _nonce;
    require(_payloadIds.length == _payloadValues.length, "payloadIds and payloadValues must be the same length");
    for (uint i = 0; i < _payloadIds.length; i++) {
      EventPayload payload = new EventPayload(_agreementId, _eventId, _eventUid, _payloadIds[i], _payloadValues[i], i);
      eventPayloads.push(payload);
    }
  }

  function updateEvent(
    string[] _payloadIds,
    string[] _payloadValues
  ) returns (uint, BeanstalkErrorCodes) {
    (uint restStatus, uint errorCode) = flatten(_payloadIds, _payloadValues);
    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode);
    }
    for (uint i = 0; i < _payloadIds.length; i++) {
      eventPayloads[i].updateEventPayload(_payloadIds[i], _payloadValues[i]);
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

  function flatten(
    string[] _payloadIds,
    string[] _payloadValues
  ) public returns (uint, BeanstalkErrorCodes) {
    // validate
    // workaround for BUG in SolidVM
    bytes memory firstElement = bytes(_payloadValues[0]);
    require(_payloadValues.length > 1 || firstElement.length > 0, "Must contain at least 1 member");
    require(_payloadValues.length <= 10, "Must contain less than 10 members");
    require(_payloadValues.length == _payloadIds.length, "Payload data should be consistent");

    // flatten
    if (_payloadValues.length > 0) {
      key0 = _payloadIds[0];
      value0 = _payloadValues[0];
    }
    if (_payloadValues.length > 1) {
      key1 = _payloadIds[1];
      value1 = _payloadValues[1];
    }
    if (_payloadValues.length > 2) {
      key2 = _payloadIds[2];
      value2 = _payloadValues[2];
    }
    if (_payloadValues.length > 3) {
      key3 = _payloadIds[3];
      value3 = _payloadValues[3];
    }
    if (_payloadValues.length > 4) {
      key4 = _payloadIds[4];
      value4 = _payloadValues[4];
    }
    if (_payloadValues.length > 5) {
      key5 = _payloadIds[5];
      value5 = _payloadValues[5];
    }
    if (_payloadValues.length > 6) {
      key6 = _payloadIds[6];
      value6 = _payloadValues[6];
    }
    if (_payloadValues.length > 7) {
      key7 = _payloadIds[7];
      value7 = _payloadValues[7];
    }
    if (_payloadValues.length > 8) {
      key8 = _payloadIds[8];
      value8 = _payloadValues[8];
    }
    if (_payloadValues.length > 9) {
      key9 = _payloadIds[9];
      value9 = _payloadValues[9];
    }
    return (RestStatus.OK, BeanstalkErrorCodes.NULL);
  }

}
