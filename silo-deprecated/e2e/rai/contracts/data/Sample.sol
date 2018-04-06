import "../SampleFsm.sol";
import "../enums/SampleState.sol";
import "../enums/SampleEvent.sol";
import "../libs/Owned.sol";

/**
  * Sample data contract
*/
contract Sample is SampleState, SampleEvent, Owned {
  SampleFsm fsm;
  SampleStateEnum currentState;
  uint buid;
  string wellName;
  string sampleType;
  string currentLocationType;
  string currentVendor;
  uint startDepthFeet;
  uint endDepthFeet;
  uint startDepthMeter;
  uint endDepthMeter;

  /**
    * Construct a sample with a given FSM, intialize currentStateName to START
    * @param sampleFsmAddr {address} - address of FSM for this item
    * @param _wellName {string} - name of well for this sample
    * @param _sampleType {string} - type of sample
    * @param _currentLocationType {string} - current location of sample
    * @param _currentVendor {string} - current vendor of sample
    * @param _startDepthFeet {uint} - start depth of sample (with some predetermined precision)
    * @param _endDepthFeet {uint} - end depth of sample (with some predetermined precision)
    * @param _startDepthMeter {uint} - start depth of sample (with some predetermined precision)
    * @param _endDepthMeter {uint} - end depth of sample (with some predetermined precision)
  */
  function Sample(
    address sampleFsmAddr,
    uint _buid,
    string _wellName,
    string _sampleType,
    string _currentLocationType,
    string _currentVendor,
    uint _startDepthFeet,
    uint _endDepthFeet,
    uint _startDepthMeter,
    uint _endDepthMeter
  ) {
    fsm = SampleFsm(sampleFsmAddr);
    currentState = SampleStateEnum.START;
    buid = _buid;
    edit(_wellName, _sampleType, _currentLocationType, _currentVendor, _startDepthFeet, _endDepthFeet, _startDepthMeter, _endDepthMeter);
  }

  /**
    * Method to set attributes of the sample
    * @param _wellName {string} - name of well for this sample
    * @param _sampleType {string} - type of sample
    * @param _currentLocationType {string} - current location of sample
    * @param _currentVendor {string} - current vendor of sample
    * @param _startDepthFeet {uint} - start depth of sample (with some predetermined precision)
    * @param _endDepthFeet {uint} - end depth of sample (with some predetermined precision)
    * @param _startDepthMeter {uint} - start depth of sample (with some predetermined precision)
    * @param _endDepthMeter {uint} - end depth of sample (with some predetermined precision)
  */
  function edit(
    string _wellName,
    string _sampleType,
    string _currentLocationType,
    string _currentVendor,
    uint _startDepthFeet,
    uint _endDepthFeet,
    uint _startDepthMeter,
    uint _endDepthMeter
  ) isOwner {
    wellName = _wellName;
    sampleType = _sampleType;
    currentLocationType = _currentLocationType;
    currentVendor = _currentVendor;
    startDepthFeet = _startDepthFeet;
    endDepthFeet = _endDepthFeet;
    startDepthMeter = _startDepthMeter;
    endDepthMeter = _endDepthMeter;
  }

  /**
    * Return current state of this sample
    * @return {SampleStateEnum} - buid of current sample state
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

  /**
    * Return whether a this sample can update to a new state from the given event
    * @param eventId {SampleEventEnum} - id of state-change event
    * @return {bool} - y or n
  */
  function canUpdate(SampleEventEnum eventId) returns (bool) {
    SampleStateEnum nextState = fsm.get(currentState, eventId);
    return nextState != SampleStateEnum.NULL;
  }

  /**
    * Return the list of valid events for the current sample state
    * @return {SampleEventEnum[]} - list of possible sample events
  */
  function availableEvents() constant returns (SampleEventEnum[]) {
    uint eventCount = fsm.availableEventCount(currentState);
    SampleEventEnum[] memory availableEvents = new SampleEventEnum[](eventCount);
    for (uint i = 0; i < eventCount; i++) {
      availableEvents[i] = fsm.availableEvent(currentState, i);
    }
    return availableEvents;
  }

  /**
    * Return current attributes of the sample
    * @return {SampleStateEnum, string, string, string, string, uint, uint, uint, uint} - sample attributes
  */
  function get() constant returns (SampleStateEnum, string, string, string, string, uint, uint, uint, uint) {
    return (currentState, wellName, sampleType, currentLocationType, currentVendor, startDepthFeet, endDepthFeet, startDepthMeter, endDepthMeter);
  }

  /**
    * Return buid for the sample
    * @return {uint} buid
  */
  function getId() constant returns (uint) {
    return buid;
  }
}
