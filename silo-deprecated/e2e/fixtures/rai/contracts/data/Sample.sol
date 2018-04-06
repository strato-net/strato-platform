import "../SampleFsm.sol";
import "../enums/SampleState.sol";
import "../enums/SampleEvent.sol";
import "../libs/Owned.sol";

contract Sample is SampleState, SampleEvent, Owned {
  SampleFsm fsm;
  SampleStateEnum currentState;

  /**
    * Construct a sample with a given FSM, intialize currentStateName to START
    * @param sampleFsmAddr {address} - address of FSM for this item
  */
  function Sample(address sampleFsmAddr) {
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
  function update(SampleEventEnum eventId) isOwner returns (SampleStateEnum) {
    SampleStateEnum nextState = fsm.get(currentState, eventId);
    if (nextState != SampleStateEnum.NULL)
      currentState = nextState;
    return nextState;
  }
}
