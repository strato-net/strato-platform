contract feline {
  function utterance() returns (bytes32);
}
contract Cat is feline {
  function utterance() returns (bytes32) { return "miaow"; }
}