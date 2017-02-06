contract ContractReg {
  struct ContractData {
    address owner;
    bytes32 ownerName;
    bytes32 appUrl; // for now <--- need arbitrary length string
    bytes32 abi; // for now <--- need arbitrary length string
  }
  address blockApps;
  ContractData gData;
  bytes32 error;
  mapping (bytes32 => ContractData) registry;
  function ContractReg() {
    blockApps = msg.sender;
  }
  function payOut() {
    if (msg.sender == blockApps) {
      blockApps.send(this.balance);
    }
  }
  function register(bytes32 name, bytes32 ownerName, bytes32 appUrl, bytes32 abi) {
    if ((registry[name].owner == 0) && (msg.value > 100)) {
      registry[name].owner = msg.sender;
      registry[name].ownerName = ownerName;
      registry[name].appUrl = appUrl;
      registry[name].abi = abi;
    } else {
      error = "val < 100 or owned.";
    } 
  }
  function getData(bytes32 name) {
    gData = registry[name];
  }
}