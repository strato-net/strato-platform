import "./SampleFsm.sol";
import "./enums/SampleState.sol";
import "./enums/SampleEvent.sol";

contract Sample is SampleState, SampleEvent {
  uint buid;
  uint wellId;
  SampleFsm fsm;
  SampleStateEnum currentState;

  /**
    * Construct a sample with a given FSM, intialize currentStateName to START
    * @param sampleFsmAddr {address} - address of FSM for this item
  */
  function Sample(uint _buid, uint _wellId, address sampleFsmAddr) {
    buid = _buid;
    wellId = _wellId;
    fsm = SampleFsm(sampleFsmAddr);
    currentState = SampleStateEnum.START;
  }

  /**
    * Return current state of this sample
    * @return {SampleStateEnum} - id of current sample state
  */
  function state() constant returns (SampleStateEnum) {
    return currentState;
  }

  /**
    * Return current state of this sample
    * @param eventId {SampleEventEnum} - id of state-change event
    * @return {SampleStateEnum} - id of new sample state
  */
  function update(SampleEventEnum eventId) returns (SampleStateEnum) {
    SampleStateEnum nextState = fsm.get(currentState, eventId);
    if (nextState != SampleStateEnum.NULL)
      currentState = nextState;
    return nextState;
  }

  function updateInt(int eventId) constant returns (SampleStateEnum) {
    SampleEventEnum eventIdEnum = SampleEventEnum.NULL;
    if (eventId == 1) { eventIdEnum = SampleEventEnum.PLAN; }
    if (eventId == 2) { eventIdEnum = SampleEventEnum.DRILL; }
    if (eventId == 3) { eventIdEnum = SampleEventEnum.SHIP; }
    if (eventId == 4) { eventIdEnum = SampleEventEnum.ACK; }
    if (eventId == 5) { eventIdEnum = SampleEventEnum.ATTACH_REPORT; }
    if (eventId == 6) { eventIdEnum = SampleEventEnum.STORE; }
    if (eventId == 7) { eventIdEnum = SampleEventEnum.SPLIT_RECEIVED; }
    if (eventId == 8) { eventIdEnum = SampleEventEnum.DESTROY; }
    if (eventId == 9) { eventIdEnum = SampleEventEnum.SPLIT_COLLECTED; }

    return update(eventIdEnum);
  }
}
