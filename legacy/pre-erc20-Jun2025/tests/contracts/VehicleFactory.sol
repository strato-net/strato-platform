pragma solidity ^0.4.8;

import "./Util.sol";

contract record VehicleFactory {
  function createVehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public {
    new Vehicle(_vin, _s0, _s1, _s2, _s3);
  }
}

contract record Vehicle is Util {
  uint timestamp;
  string public vin;
  string public s0;
  string public s1;
  string public s2;
  string public s3;
  string public s4;
  string public s5;
  string public s6;
  string public s7;

  function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public {
    timestamp = block.timestamp;
    vin = _vin;
    s0 = _s0;
    s1 = _s1;
    s2 = _s2;
    s3 = _s3;
  }

  function vin32() returns (bytes32) {
    return b32(vin);
  }

  function set(string _s4, string _s5, string _s6, string _s7) {
    s4 = _s4;
    s5 = _s5;
    s6 = _s6;
    s7 = _s7;
  }
}
