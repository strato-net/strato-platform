contract Lottery {
  address[] public entries;
  uint public ticketCount;
  uint public ticketPrice;

  uint public winner;
  address public winnerAddress;

  function Lottery(uint _ticketCount, uint _ticketPrice) {
    if (_ticketCount < 2) {
      throw;
    }
    ticketCount = _ticketCount;
    ticketPrice = _ticketPrice;
    winnerAddress = 0;
  }

  function enter() payable returns (bool) {
    if (msg.value < ticketPrice) {
      return false;
    }
    if (entries.length >= ticketCount) {
      return false;
    }
    entries.push(msg.sender);
    if (entries.length >= ticketCount) {
      return payout();
    }
    return true;
   }

  /* return a random index into entries */
  function rand(uint seed) internal returns (uint) {
    return uint(keccak256(seed)) % entries.length;
  }

  function testRand(uint seed) returns (uint) {
    if (entries.length < 2) {
      return 99999999;
    }
    return rand(seed);
  }

  function payout() internal returns (bool){
    winner = rand(block.number);
    winnerAddress = entries[winner];
    winnerAddress.send(this.balance);
    return true;
  }
}
