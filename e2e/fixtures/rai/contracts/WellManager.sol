import "./data/Well.sol";

contract WellManager {
  Well[] data;
  mapping (string => uint) dataMap;

  function WellManager() {
    data.length = 1;
  }

  function add(string name, string wellHeadBUID, string boreHoleBUID) {
    if (uint(dataMap[name]) > 0) throw;
    dataMap[name] = data.length;
    data.push(new Well(name, wellHeadBUID, boreHoleBUID));
  }

  function getId(string name) constant returns (uint) {
    return dataMap[name];
  }

  function getAddress(string name) constant returns (address) {
    return address(data[dataMap[name]]);
  }

}
