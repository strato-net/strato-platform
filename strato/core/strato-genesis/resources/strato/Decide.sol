interface GetImplContract {
    function getImplContract() public view returns (address);
}

contract record Decider {
    constructor() {
    }

    function decide() returns (bool) {
      GetImplContract deciderStateContract = GetImplContract(address(0xDEC1DE02));
      address payFeesImplContract = deciderStateContract.getImplContract();
      payFeesImplContract.delegatecall("payFees");
      return true;
    }
}
