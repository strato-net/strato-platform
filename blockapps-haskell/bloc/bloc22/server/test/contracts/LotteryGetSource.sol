contract Lottery {

    address[] public entries;
    uint public ticketCount;
    uint public ticketPrice;
    uint public winner;
    address public winnerAddress;
    function Lottery(uint _ticketCount, uint _ticketPrice) public {
        if (_ticketCount < 2) {throw;
    }ticketCount = _ticketCount;
    ticketPrice = _ticketPrice;
    winnerAddress = 0;
  
    }
    function __getContractName__() view returns (string) {
        return "Lottery";
    }
    function __getSource__() view public returns (string) {
        return "contract Lottery {\n  address[] public entries;\n  uint public ticketCount;\n  uint public ticketPrice;\n\n  uint public winner;\n  address public winnerAddress;\n\n  function Lottery(uint _ticketCount, uint _ticketPrice) {\n    if (_ticketCount < 2) {\n      throw;\n    }\n    ticketCount = _ticketCount;\n    ticketPrice = _ticketPrice;\n    winnerAddress = 0;\n  }\n\n  function enter() payable returns (bool) {\n    if (msg.value < ticketPrice) {\n      return false;\n    }\n    if (entries.length >= ticketCount) {\n      return false;\n    }\n    entries.push(msg.sender);\n    if (entries.length >= ticketCount) {\n      return payout();\n    }\n    return true;\n   }\n\n  /* return a random index into entries */\n  function rand(uint seed) internal returns (uint) {\n    return uint(keccak256(seed)) % entries.length;\n  }\n\n  function testRand(uint seed) returns (uint) {\n    if (entries.length < 2) {\n      return 99999999;\n    }\n    return rand(seed);\n  }\n\n  function payout() internal returns (bool){\n    winner = rand(block.number);\n    winnerAddress = entries[winner];\n    winnerAddress.send(this.balance);\n    return true;\n  }\n}\n";
    }
    function enter() payable public returns (bool) {
        if (msg.value < ticketPrice) {return false;
    }if (entries.length >= ticketCount) {return false;
    }entries.push(msg.sender);
    if (entries.length >= ticketCount) {return payout();
    }return true;
   
    }
    function payout() internal returns (bool) {
        winner = rand(block.number);
    winnerAddress = entries[winner];
    winnerAddress.send(this.balance);
    return true;
  
    }
    function rand(uint seed) internal returns (uint) {
        return uint(keccak256(seed)) % entries.length;
  
    }
    function testRand(uint seed) public returns (uint) {
        if (entries.length < 2) {return 99999999;
    }return rand(seed);
  
    }
}
