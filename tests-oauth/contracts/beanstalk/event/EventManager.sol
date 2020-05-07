import "../Hashmap.sol";
import "../RestStatus.sol";
import "../Util.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "./Event.sol";
import "../ErrorCodes.sol";

/**
* Event Manager
*
* Entry point to create new events and access existing event by eventId
*
* #see Event
*
* #return none
*/

contract EventManager is RestStatus, ErrorCodes, Util, BeanstalkErrorCodes {
  Hashmap events;

  /**
  * Constructor
  */
  constructor () public {
    events = new Hashmap();
  }

  function createEvent(
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
  ) public returns (uint, BeanstalkErrorCodes, address) {
    // create new
    Event evnt = new Event(
      _agreementId,
      _eventCategory,
      _eventId,
      _eventUid,
      _order,
      _payloadIds,
      _payloadValues,
      _source,
      _timestamp,
      _nonce
    );
    events.put(_eventUid, evnt);
    // created
    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, evnt);
  }

  function updateEvent(
    string _eventUid,
    string[] _payloadIds,
    string[] _payloadValues
  ) public returns (uint, BeanstalkErrorCodes, address) {
    (uint getRestStatus, uint eventAddress) = get(_eventUid);

    if (getRestStatus != RestStatus.OK) {
      return (getRestStatus, BeanstalkErrorCodes.EVENT_NOT_FOUND, 0);
    }

    Event evnt = Event(eventAddress);
    (uint restStatus, uint errorCode) = evnt.updateEvent(_payloadIds, _payloadValues);

    if (restStatus != RestStatus.OK) {
      return (restStatus, errorCode, 0);
    }

    return (RestStatus.OK, BeanstalkErrorCodes.NULL, evnt);
  }

  function get(string _eventUid) public view returns (uint, address) {
    if (!contains(_eventUid)) return (RestStatus.NOT_FOUND, 0);
    return (RestStatus.OK, events.get(_eventUid));
  }

  function contains(string _eventUid) public view returns (bool) {
    return events.contains(_eventUid);
  }
}
