import "/blockapps-sol/meta/searchable/contracts/Searchable.sol";
import "/server/dapp/echoPermission/contracts/EchoPermissionManager.sol";
import "/server/dapp/deal/common/contracts/DealType.sol";
import "/server/dapp/deal/common/contracts/PriceType.sol";
import "/server/dapp/deal/common/contracts/RejectionType.sol";

/**
 * Deal data container
 */
contract BaseDeal is Searchable, RestStatus, DealType, PriceType, RejectionType {
  // internal
  string public uid;
  uint public timestamp;

  // model
  DealType dealType;

  // price
  PriceType public priceType;

  bool public isBuyDeal;
  string public buyParty;
  string public sellParty;
  string public beginFlowDate;
  string public endFlowDate;

  string public dealDate;
  uint8 public hourEnding;

  uint32 public traderId;
  uint32 public counterPartyId;

  int public dealPrice;
  int public indexPriceAdder;
  int public traderPrice;
  int public traderAdder;
  int public counterPartyPrice;
  int public counterPartyAdder;

  int32 public volume;

  int32 public exceptionCutVolume;

  // rejection
  // RejectionType public rejectionType = RejectionType.NULL; FIXME when API-98 is done: extended property is immutable to classes that implement BaseDeal
  string public rejectionReason;
  uint64 public rejectionTime;

  EchoPermissionManager public echoPermissionManager;

  constructor() {}

  //========================================================
  // Event Log
  //========================================================
  struct EventLogEntry {
    // meta
    address msgSender;
    uint blockTimestamp;
    uint userLocalTime;
    // event
    uint dealType;
    uint dealEvent;
    int eventPayloadInt;
    string eventPayloadString;
    uint restStatus;
    // contract data
    uint dealState;
    int traderPrice;
    int counterPartyPrice;
  }

  // event log array
  EventLogEntry[] eventLog;

  /**
   * Log an event for Audit Trail
   *
   * @param {number} _dealType deal type
   * @param {number} _gasDealEvent event type
   * @param {number} _eventPayloadInt event payload - int
   * @param {number} _eventPayloadString event payload - string
   * @param {number} _userLocalTime local user time milli
   * @param {number} _restStatus event RestStatus result
   * @param {number} _dealState current deal state
   * @return {number, number, number} RestStatus, The new log entry index, searchCounter
   */
  function logEvent(
    address _msgSender,
    uint _dealType,
    uint _dealEvent,
    int _eventPayloadInt,
    string _eventPayloadString,
    uint _userLocalTime,
    uint _restStatus,
    uint _dealState
  ) public returns (uint, uint, uint) {
    // store the event + contract data
    EventLogEntry memory eventLogEntry = EventLogEntry(
      _msgSender,
      block.timestamp,
      _userLocalTime,
      _dealType,
      // _gasDealEvent,  // FIXME: API-92
      _dealEvent,
      _eventPayloadInt,
      _eventPayloadString,
      _restStatus,
      // gasDealState,  // FIXME: API-92
      _dealState,
      traderPrice,
      counterPartyPrice
    );
    eventLog.push(eventLogEntry);
    return (RestStatus.OK, eventLog.length, searchable());
  }

}
