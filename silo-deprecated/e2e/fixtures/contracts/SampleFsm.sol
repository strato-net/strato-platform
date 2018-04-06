import "./enums/SampleEvent.sol";
import "./enums/SampleState.sol";

contract SampleFsm is SampleEvent, SampleState {
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
  }

  /**
    * Construct a FSM for controlling Samples state transitions
  */
  function SampleFsm() {
        addTransition(SampleStateEnum.START, SampleEventEnum.PLAN, SampleStateEnum.PLANNED);
        addTransition(SampleStateEnum.START, SampleEventEnum.SPLIT_COLLECTED, SampleStateEnum.COLLECTED);
        addTransition(SampleStateEnum.START, SampleEventEnum.SPLIT_RECEIVED, SampleStateEnum.RECEIVED);
        addTransition(SampleStateEnum.PLANNED, SampleEventEnum.DRILL, SampleStateEnum.COLLECTED);
        addTransition(SampleStateEnum.COLLECTED, SampleEventEnum.SHIP, SampleStateEnum.SHIPPED);
        addTransition(SampleStateEnum.COLLECTED, SampleEventEnum.DESTROY, SampleStateEnum.DESTROYED);
        addTransition(SampleStateEnum.COLLECTED, SampleEventEnum.SPLIT_COLLECTED, SampleStateEnum.COLLECTED_SPLIT);
        addTransition(SampleStateEnum.COLLECTED_SPLIT, SampleEventEnum.SPLIT_COLLECTED, SampleStateEnum.COLLECTED_SPLIT);
        addTransition(SampleStateEnum.STORED, SampleEventEnum.SHIP, SampleStateEnum.SHIPPED);
        addTransition(SampleStateEnum.SHIPPED, SampleEventEnum.ACK, SampleStateEnum.RECEIVED);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.ATTACH_REPORT, SampleStateEnum.ANALYZED);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.STORE, SampleStateEnum.STORED);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.DESTROY, SampleStateEnum.DESTROYED);
        addTransition(SampleStateEnum.RECEIVED, SampleEventEnum.SPLIT_RECEIVED, SampleStateEnum.RECEIVED_SPLIT);
        addTransition(SampleStateEnum.RECEIVED_SPLIT, SampleEventEnum.SPLIT_RECEIVED, SampleStateEnum.RECEIVED_SPLIT);
        addTransition(SampleStateEnum.ANALYZED, SampleEventEnum.ATTACH_REPORT, SampleStateEnum.ANALYZED);
        addTransition(SampleStateEnum.ANALYZED, SampleEventEnum.SHIP, SampleStateEnum.SHIPPED);
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
}
