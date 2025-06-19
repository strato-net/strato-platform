contract record Sample {

  uint buid;
  string wellName;
  string sampleType;
  string currentLocationType;
  string currentVendor;
  uint startDepthFeet;
  uint endDepthFeet;
  uint startDepthMeter;
  uint endDepthMeter;

  function Sample(
    uint _buid,
    string _wellname,
    string _sampletype,
    string _currentlocationtype,
    string _currentvendor,
    uint _startdepthfeet,
    uint _enddepthfeet,
    uint _startdepthmeter,
    uint _enddepthmeter) {
    buid = _buid;
    wellName = _wellname;
    sampleType = _sampletype;
    currentLocationType = _currentlocationtype;
    currentVendor = _currentvendor;
    startDepthFeet = _startdepthfeet;
    endDepthFeet = _enddepthfeet;
    startDepthMeter = _startdepthmeter;
    endDepthMeter = _enddepthmeter;
  }
}

contract record SampleManager {
  Sample[] data;
  uint nextBuid;
  mapping (uint => uint) buidToIndex;
  mapping (uint => bool) validBuids;


  function SampleManager(uint startIndex) {
    nextBuid = startIndex;
  }

  function getAddress(uint buid) constant returns (address) {
    if (!validBuids[buid]) return 0;
    return address(data[buidToIndex[buid]]);
  }


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
    validBuids[buid] = true;
    data.push(new Sample(buid, wellname, sampletype, currentlocationtype, currentvendor, startdepthfeet, enddepthfeet, startdepthmeter, enddepthmeter));
  }


  function getSamples() constant returns (Sample[]) {
    return data;
  }


  function getSampleCount() constant returns (uint) {
    return data.length;
  }


}