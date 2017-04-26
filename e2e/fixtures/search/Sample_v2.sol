contract Sample {

  uint buid;
  string wellName;
  string sampleType;
  string currentLocationType;
  string currentVendor;
  string sampleState;
  uint startDepthFeet;
  uint endDepthFeet;
  uint startDepthMeter;
  uint endDepthMeter;

  function Sample(
    uint _buid,
    string wellname,
    string sampletype,
    string currentlocationtype,
    string currentvendor,
    string samplestate,
    uint startdepthfeet,
    uint enddepthfeet,
    uint startdepthmeter,
    uint enddepthmeter) {
    buid = _buid;
    wellName = wellname;
    sampleType = sampletype;
    currentLocationType = currentlocationtype;
    currentVendor = currentvendor;
    sampleState = samplestate;
    startDepthFeet = startdepthfeet;
    endDepthFeet = enddepthfeet;
    startDepthMeter = startdepthmeter;
    endDepthMeter = enddepthmeter;
  }

}
