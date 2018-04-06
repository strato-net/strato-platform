import "./child.sol"
contract Parent {
  function getChild() returns (address) {
    address child = new Child("parent");
    return child;
  }
  function getUint() returns (uint) {
    return 666;
  }
}
