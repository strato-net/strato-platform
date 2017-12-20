contract Version {
  uint version;

  function __getSource__() constant returns (string) {
      return "contract Version {  uint version;}";
  }
}