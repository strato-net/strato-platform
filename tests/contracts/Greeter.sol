import './Mortal.sol'

contract record Greeter is Mortal {
  string greeting;

  function greeter(string _greeting) public {
    greeting = _greeting;
  }

  function greet() constant returns (string) {
    return greeting;
  }
}