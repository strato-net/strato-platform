import "/blockapps-sol/util/contracts/Util.sol";
import "/blockapps-sol/rest/contracts/RestStatus.sol";
import "/server/dapp/echoPermission/contracts/EchoPermissionManager.sol";
import "/server/dapp/deal/common/contracts/PriceType.sol";
import "/server/dapp/deal/common/contracts/Args.sol";
import "/server/dapp/deal/common/contracts/BaseDeal.sol";
import "/server/dapp/deal/common/contracts/DealType.sol";
import "/server/dapp/deal/common/contracts/PriceType.sol";
import "/server/dapp/deal/common/contracts/Constants.sol";

import "./GasDealState.sol";
import "./GasDealEvent.sol";
import "./GasDealFSM.sol";
import "./GasVolumeUnits.sol";

/**
 * Gas Deal data container
 */
contract GasDeal is BaseDeal, Util, Args, GasDealState, GasDealEvent, GasVolumeUnits, Constants {
  // internal
  GasDealFSM public gasDealFSM;
  GasDealState public gasDealState;

  // gas model
  string public pipelineEBB;
  string public receiptLocation;

  int32 public ebbDissagVolume;
  RejectionType public rejectionType;
  GasVolumeUnits public volumeUnits;
  string public strategy;
  int public exceptionCutVolume;

  constructor(
    address _echoPermissionManager,
    bytes32[] _bytes32Array
  ) {

    //FIXME switch block.timestamp to an input with the unix epoch timestamp in greenwich time
    timestamp = block.timestamp;

    // internal
    echoPermissionManager = EchoPermissionManager(_echoPermissionManager);
    timestamp       = block.timestamp;
    gasDealFSM      = new GasDealFSM();

    // TODO ECHO-358
    // args
    uid             = bytes32ToString(_bytes32Array[uint(Args.UID)]);
    isBuyDeal       = uint(_bytes32Array[uint(Args.IS_BUY_DEAL)]) == 0 ? false : true;
    traderId        = uint32(_bytes32Array[uint(Args.TRADER_ID)]);
    counterPartyId  = uint32(_bytes32Array[uint(Args.COUNTER_PARTY_ID)]);
    buyParty        = bytes32ToString(_bytes32Array[uint(Args.BUY_PARTY)]);
    sellParty       = bytes32ToString(_bytes32Array[uint(Args.SELL_PARTY)]);
    dealPrice       = int(_bytes32Array[uint(Args.DEAL_PRICE)]);
    priceType       = PriceType(uint32(_bytes32Array[uint(Args.PRICE_TYPE)]));
    dealDate        = bytes32ToString(_bytes32Array[uint(Args.DEAL_DATE)]);
    beginFlowDate   = bytes32ToString(_bytes32Array[uint(Args.BEGIN_FLOW_DATE)]);
    endFlowDate     = bytes32ToString(_bytes32Array[uint(Args.END_FLOW_DATE)]);
    pipelineEBB     = bytes32ToString(_bytes32Array[uint(Args.PIPELINE_EBB)]);
    receiptLocation = bytes32ToString(_bytes32Array[uint(Args.RECEIPT_LOCATION)]);
    volume          = int32(_bytes32Array[uint(Args.VOLUME)]);
    indexPriceAdder = int(_bytes32Array[uint(Args.INDEX_PRICE_ADDER)]);
    volumeUnits     = GasVolumeUnits(uint32(_bytes32Array[uint(Args.GAS_VOLUME_UNITS)]));
    strategy        = bytes32ToString(_bytes32Array[uint(Args.STRATEGY)]);

    // init
    dealType        = DealType.GAS;
    gasDealState    = GasDealState.WAIT_COUNTER_PRICE;
    traderPrice     = int(_bytes32Array[uint(Args.DEAL_PRICE)]);
    traderAdder     = int(_bytes32Array[uint(Args.INDEX_PRICE_ADDER)]);
    rejectionType   = RejectionType.NULL; // FIXME API-98 extended property is immutable to subclasses
  }

  function handleEvent(GasDealEvent _event) public returns (uint, GasDealState, uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED, GasDealState.NULL, 0);
    // check validity
    GasDealState newState = gasDealFSM.handleEvent(gasDealState, _event);
    if (newState == GasDealState.NULL) {
      return (RestStatus.BAD_REQUEST, GasDealState.NULL, 0);
    }
    // assume new state
    gasDealState = newState;
    return (RestStatus.OK, gasDealState, searchable());
  }

  function setTraderPrice(int _price, int _adder) public returns (uint, uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED, 0);
    // do it
    traderPrice = _price;
    traderAdder = _adder;
    return (RestStatus.OK, searchable());
  }

  function setCounterPartyPrice(int _price, int _adder) public returns (uint, uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED, 0);
    // do it
    counterPartyPrice = _price;
    counterPartyAdder = _adder;
    return (RestStatus.OK, searchable());
  }

  function recordRejection( RejectionType _rejectionType, string _rejectionReason, uint64 _rejectionTime ) public returns (uint, uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED, 0);
    // prevent partially constructed contract
    if (gasDealState == GasDealState.NULL) {
      return (RestStatus.BAD_REQUEST, 0);
    }

    // do it
    rejectionType = _rejectionType;
    rejectionReason = _rejectionReason;
    rejectionTime = _rejectionTime;
    return (RestStatus.OK, searchable());
  }

  function createExceptionCut(int _exceptionCutVolume) public returns (uint, uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED, 0);
    // do it
    exceptionCutVolume = _exceptionCutVolume;
    return (RestStatus.OK, searchable());
  }

  function recordDissag(int32 _ebbDissagVolume) public returns (uint, uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED, 0);
    // do it
    ebbDissagVolume = _ebbDissagVolume;
    return (RestStatus.OK, searchable());
  }

  function isPriceMatch() constant returns (bool) {
    return traderPrice == counterPartyPrice && traderAdder == counterPartyAdder;
  }

  function isDissagMatch() constant returns (bool) {
    return volume == ebbDissagVolume;
  }

  function isMaxPrice(int _dealPrice) constant returns (bool) {
    return _dealPrice > int(Constants.MAX_DEAL_PRICE * (10 ** Constants.PRECISION));
  }

  function selfDestruct() public returns (uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED);
    // BAM !
    selfdestruct(msg.sender);
    return (RestStatus.OK);
  }

  /**
   * Log an event for Audit Trail
   *
   * @param {number} _gasDealEvent event
   * @param {number} _eventPayloadInt event payload - int
   * @param {number} _eventPayloadString event payload - string
   * @param {number} _userLocalTime local user time milli
   * @param {number} _restStatus event RestStatus result
   * @return {number, number, number} RestStatus, The new log entry index, , searchCounter
   */
  function logEvent(
    address _msgSender,
    GasDealEvent _gasDealEvent,
    int _eventPayloadInt,
    string _eventPayloadString,
    uint _userLocalTime,
    uint _restStatus
  ) public returns (uint, uint, uint) {
    // check permissions
    if (!echoPermissionManager.canModifyGasDeal(msg.sender)) return (RestStatus.UNAUTHORIZED, 0, 0);
    // call up
    return super.logEvent(
      _msgSender,
      uint(DealType.GAS),
      uint(_gasDealEvent),
      _eventPayloadInt,
      _eventPayloadString,
      _userLocalTime,
      _restStatus,
      uint(gasDealState)
    );
  }
}
