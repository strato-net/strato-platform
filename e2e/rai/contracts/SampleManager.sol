import "./enums/SampleEvent.sol";
import "./enums/SampleState.sol";
import "./libs/Administered.sol";
import "./SampleFsm.sol";
import "./data/Sample.sol";

/**
  * Admin Interface for SampleManager, exposing the sampleFsm
*/
contract IAdminSM {
  SampleFsm public sampleFsm;
}

/**
  * Interface for sample data contracts
*/
contract SampleManager is SampleEvent, SampleState, Administered {
  Sample[] data;
  uint nextBuid;
  mapping (uint => uint) buidToIndex;

  /**
    * Constructor
    * @param startIndex {uint} - the starting BUID for new samples (enables upgrading)
  */
  function SampleManager(uint startIndex) {
    nextBuid = startIndex;
  }

  /**
    * Return the data contract address of a given sample buid
    * @param buid {uint} - sample buid
    * @return {address} - address of the Sample() contract corresponding to buid
  */
  function getAddress(uint buid) constant returns (address) {
    return address(data[buidToIndex[buid]]);
  }

  /**
    * Construct a sample with given attributes. It will be assigned the START state
    * @param wellname {string} - name of well for this sample
    * @param sampletype {string} - type of sample
    * @param currentlocationtype {string} - current location of sample
    * @param currentvendor {string} - current vendor of sample
    * @param startdepthfeet {uint} - start depth of sample (with some predetermined precision)
    * @param enddepthfeet {uint} - end depth of sample (with some predetermined precision)
    * @param startdepthmeter {uint} - start depth of sample (with some predetermined precision)
    * @param enddepthmeter {uint} - end depth of sample (with some predetermined precision)
    * @return {uint} - buid of the newly created sample
  */
  function add(
    string wellname,
    string sampletype,
    string currentlocationtype,
    string currentvendor,
    uint startdepthfeet,
    uint enddepthfeet,
    uint startdepthmeter,
    uint enddepthmeter
  ) returns (uint buid) {
    buid = nextBuid++;
    buidToIndex[buid] = data.length;
    address sampleFsm = address(IAdminSM(getAdmin()).sampleFsm());
    data.push(new Sample(sampleFsm, buid, wellname, sampletype, currentlocationtype, currentvendor, startdepthfeet, enddepthfeet, startdepthmeter, enddepthmeter));
  }

  /**
    * Construct a number of identitcal sample with the given attributes. It will be assigned the START state
    * @param count {uint} - number of samples to create with these attributes
    * @param wellname {string} - name of well for this sample
    * @param sampletype {string} - type of sample
    * @param currentlocationtype {string} - current location of sample
    * @param currentvendor {string} - current vendor of sample
    * @param startdepthfeet {uint} - start depth of sample (with some predetermined precision)
    * @param enddepthfeet {uint} - end depth of sample (with some predetermined precision)
    * @param startdepthmeter {uint} - start depth of sample (with some predetermined precision)
    * @param enddepthmeter {uint} - end depth of sample (with some predetermined precision)
    * @return {uint[]} - buids of the newly created sample
  */
  function addMultiple(
    uint count,
    string wellname,
    string sampletype,
    string currentlocationtype,
    string currentvendor,
    uint startdepthfeet,
    uint enddepthfeet,
    uint startdepthmeter,
    uint enddepthmeter
  ) returns(uint[]) {
    uint[] memory buids = new uint[](count);
    for (uint i = 0; i < count; i++) {
      uint newBuid = add(wellname, sampletype, currentlocationtype, currentvendor, startdepthfeet, enddepthfeet, startdepthmeter, enddepthmeter);
      buids[i] = newBuid;
    }
    return buids;
  }

  /**
    * Update the state of a sample
    * @param buid {uint} - BUID of sample to have state updated
    * @param sampleEvent {SampleEventEnum} - event pass to the sample
    * @return {SampleStateEnum} - new state of the sample
  */
  function update(uint buid, SampleEventEnum sampleEvent) returns (SampleStateEnum) {
    return Sample(data[buidToIndex[buid]]).update(sampleEvent);
  }

  /**
    * Update the state of many samples. If any updates fail, none will update
    * @param buids {uint[]} - BUIDs of samples to have state updated
    * @param sampleEvent {SampleEventEnum} - event pass to the sample
    * @return {SampleStateEnum} - new state of the samples
  */
  function updateMany(uint[] buids, SampleEventEnum sampleEvent) returns (SampleStateEnum) {
    bool canUpdate = true;
    for (uint i = 0; i < buids.length; i++) {
      canUpdate = canUpdate && Sample(data[buidToIndex[buids[i]]]).canUpdate(sampleEvent);
    }

    // return NULL if any address cannot update
    if (!canUpdate) return SampleStateEnum.NULL;

    // Update all samples
    for (uint j = 0; j < buids.length; j++) {
      SampleStateEnum newState = Sample(data[buidToIndex[buids[j]]]).update(sampleEvent);
    }
    return newState;
  }


  /**
    * Return all sample addresses
    * @return {address[]} - array of sample addresses
  */
  function getSamples() constant returns (Sample[]) {
    return data;
  }


  /**
    * Return all sample addresses
    * @return {uint} - number of samples currently recorded
  */
  function getSampleCount() constant returns (uint) {
    return data.length;
  }

}
