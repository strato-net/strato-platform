import "./enums/SampleEvent.sol";
import "./enums/SampleState.sol";

/**
  * FSM for a Sample
*/
contract SampleFsm is SampleEvent, SampleState {
  mapping (uint => SampleEventEnum[]) validEvents;
  mapping (bytes32 => SampleStateEnum) validTransitions;

  /**
    * Construct a FSM for controlling Samples state transitions
    * @param currentState {SampleStateEnum} - enum Id for current state
    * @param eventId {SampleEventEnum} - enum id for event
    * @param nextState {SampleStateEnum} - enum id for nextState
  */
  function addTransition(
    SampleStateEnum currentState,
    SampleEventEnum eventId,
    SampleStateEnum nextState
  ) internal {
    bytes32 index = sha3(currentState, eventId);
    // prevent overwriting
    if (validTransitions[index] != SampleStateEnum.NULL) throw;
    validTransitions[index] = nextState;
    validEvents[uint(currentState)].push(eventId);
  }

  /**
    * Construct a FSM for controlling Samples state transitions
  */
  function SampleFsm() {
        addTransition(SampleStateEnum.START, SampleEventEnum.PLAN, SampleStateEnum.PLANNED);
        addTransition(SampleStateEnum.PLANNED, SampleEventEnum.DRILL, SampleStateEnum.COLLECTED);
        addTransition(SampleStateEnum.COLLECTED, SampleEventEnum.SPLIT, SampleStateEnum.COLLECTED);
        addTransition(SampleStateEnum.COLLECTED, SampleEventEnum.SHIP, SampleStateEnum.SHIPPED);
        addTransition(SampleStateEnum.COLLECTED, SampleEventEnum.DESTROY, SampleStateEnum.END);
        addTransition(SampleStateEnum.COLLECTED, SampleEventEnum.DEPLETE, SampleStateEnum.END);
        addTransition(SampleStateEnum.SHIPPED, SampleEventEnum.ACK, SampleStateEnum.RECEIVED);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.ANALYZE, SampleStateEnum.ANALYZED);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.SPLIT, SampleStateEnum.RECEIVED);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.DESTROY, SampleStateEnum.END);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.DEPLETE, SampleStateEnum.END);
        addTransition(SampleStateEnum.ANALYZED, SampleEventEnum.DESTROY, SampleStateEnum.END);
        addTransition(SampleStateEnum.ANALYZED, SampleEventEnum.DEPLETE, SampleStateEnum.END);
        addTransition(SampleStateEnum.ANALYZED, SampleEventEnum.SHIP, SampleStateEnum.SHIPPED);
        addTransition(SampleStateEnum.ANALYZED, SampleEventEnum.STORE, SampleStateEnum.STORED);
        addTransition(SampleStateEnum.STORED, SampleEventEnum.DEPLETE, SampleStateEnum.END);
        addTransition(SampleStateEnum.STORED, SampleEventEnum.DESTROY, SampleStateEnum.END);
        addTransition(SampleStateEnum.STORED, SampleEventEnum.SHIP, SampleStateEnum.SHIPPED);
  }

  /**
    * Get the next state id given a current state and event id
    * @param currentState {SampleStateEnum} - enum Id for current state
    * @param eventId {SampleEventEnum} - enum id for event
    * @return {SampleStateEnum} - enum id for nextState
  */
  function get(SampleStateEnum currentState, SampleEventEnum eventId) constant returns (SampleStateEnum) {
    return validTransitions[sha3(currentState, eventId)];
  }

  /**
    * Get the list of all possible events for a current state
    * @param currentState {SampleStateEnum} - enum Id for current state
    * @param eventIndex {uint} - index of the event in validEvents at the given state
    * @return {SampleEventEnum} - event id available at given index
  */
  function availableEvent(SampleStateEnum currentState, uint eventIndex) constant returns (SampleEventEnum) {
    return validEvents[uint(currentState)][eventIndex];
  }

  /**
    * Get the number of all possible events for a current state
    * @param currentState {SampleStateEnum} - enum Id for current state
    * @return {uint} - number of possible events
  */
  function availableEventCount(SampleStateEnum currentState) constant returns (uint) {
    return validEvents[uint(currentState)].length;
  }

}
