/**
  * Report data contract
*/
contract Report {
  string data;
  address owner;
  uint timestamp;

  /**
    * Constructor
    * @param _data {string} - data to store for this report
  */
  function Report(string _data) {
    timestamp = now;
    owner = msg.sender;
    data = _data;
  }

  /**
    * Get the attributes of this report
    * @return {string, address, uint} - returns the private attributes of this report
  */
  function get() constant returns(string, address, uint) {
    return (data, owner, timestamp);
  }
}
