import "/dapp/dapp/contracts/PrivateChainType.sol";

/**
 * Payload Definition container
 *
 * This container holds the data for one payload definition for an event definition.
 *
 * #return none
 */

contract PayloadDefinition {

  address public dappAddress;
  address public owner;
  string public eventId;
  string public payloadId;
  string public payloadType;
  uint public index;

  constructor(
    address _dappAddress,
    string _eventId,
    string _payloadId,
    string _payloadType,
    uint _index
  ) {
    owner = msg.sender;
    dappAddress = _dappAddress;
    eventId = _eventId;
    payloadId = _payloadId;
    payloadType = _payloadType;
    index = _index;
  }
}
