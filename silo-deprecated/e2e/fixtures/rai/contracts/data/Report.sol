contract Report {
  string data;
  address owner;
  uint timestamp;

  function Report(string d) {
    timestamp = now;
    owner = msg.sender;
    data = d;
  }

  /**
    * Get the attributes of this report
    * @return {string, address, uint} - returns the private attributes of this report
  */
  function get() constant returns(string, address, uint) {
    return (data, owner, timestamp);
  }
}
