contract owned {
  function owned() { owner = msg.sender; }
  address owner;

  // This contract only defines a modifier but does not use it - it will
  // be used in derived contracts.
  // The function body is inserted where the special symbol "_" in the
  // definition of a modifier appears.
  modifier onlyowner { if (msg.sender == owner) _ }
}
contract mortal is owned {
  // This contract inherits the "onlyowner"-modifier from "owned" and
  // applies it to the "kill"-function, which causes that calls to "kill"
  // only have an effect if they are made by the stored owner.
  function kill() onlyowner {
    suicide(owner);
  }
}
contract priced {
  // Modifiers can receive arguments:
  modifier costs(uint price) { if (msg.value >= price) _ }
}
contract Register is priced, owned {
  mapping (address => bool) registeredAddresses;
  uint price;
  function Register(uint initialPrice) { price = initialPrice; }
  function register() costs(price) {
    registeredAddresses[msg.sender] = true;
  }
  function changePrice(uint _price) onlyowner {
    price = _price;
  }
}