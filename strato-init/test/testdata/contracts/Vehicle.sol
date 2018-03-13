contract Vehicle {
  uint timestamp;
  string public vin;
  string public s0;

  function vin() public returns (string) {
    return vin;
  }

  function init(string _vin, string _s0) public {
    timestamp = block.timestamp;
    vin = _vin;
    _s0 = s0;
  }
}
