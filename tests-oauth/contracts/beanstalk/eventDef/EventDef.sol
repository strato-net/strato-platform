import "../dapp/PrivateChainType.sol";
import "../eventDef/PayloadDefinition.sol";

/**
 * Event Definition container
 *
 * This container holds the data for one event definition. The eventDefs list is managed by the EventDefList
 *
 * #see EventDefList
 *
 * #param {string} eventId : unique event ID
 *
 * #return none
 */

contract EventDef is PrivateChainType {

  address public dappAddress;
  address public owner;
  PrivateChainType public chainType;
  string public eventCategory;
  string public eventDescription;
  string public eventId;
  string public programId;
  string public programName;
  string public eventType;
  string public order;
  string[] public payloadIds;
  string[] public payloadTypes;
  PayloadDefinition[] payloadDefinitions;
  string public source;
  string public uniqueKey;

constructor(
    address _dappAddress,
    PrivateChainType _chainType,
    string _eventCategory,
    string _eventDescription,
    string _eventId,
    string _programId,
    string _programName,
    string _eventType,
    string _order,
    string[] _payloadIds,
    string[] _payloadTypes,
    string _source,
    string _uniqueKey
  ) {
    owner = msg.sender;
    dappAddress = _dappAddress;
    chainType = _chainType;
    eventCategory = _eventCategory;
    eventDescription = _eventDescription;
    eventId = _eventId;
    programId = _programId;
    programName = _programName;
    eventType = _eventType;
    order = _order;
    payloadIds = _payloadIds;
    payloadTypes = _payloadTypes;
    source = _source;
    uniqueKey = _uniqueKey;
    require(_payloadIds.length == _payloadTypes.length, "payloadIds and payloadTypes must be the same length");
    for (uint i = 0; i < _payloadIds.length; i++) {
      PayloadDefinition def = new PayloadDefinition(_dappAddress, _eventId, _payloadIds[i], _payloadTypes[i], i);
      payloadDefinitions.push(def);
    }
  }
}
