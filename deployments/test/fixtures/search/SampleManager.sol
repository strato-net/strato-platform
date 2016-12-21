import "./Sample.sol";
import "./SimpleStorage.sol";

contract SampleManager {
  Sample[] data;
  SimpleStorage[] simpleData;
  uint nextBuid;
  mapping (uint => uint) buidToIndex;
  mapping (uint => bool) validBuids;


  function SampleManager() {
    nextBuid = 1;
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

  function addSimple(uint x) {
    simpleData.push(new SimpleStorage(x));
  }


  function getSamples() constant returns (Sample[]) {
    return data;
  }


  function getSampleCount() constant returns (uint) {
    return data.length;
  }


}
