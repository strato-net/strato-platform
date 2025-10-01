import "../../abstract/ERC20/access/Ownable.sol";

contract record Proxy is Ownable {
    address logicContract;

    constructor(address _logicContract, address _initialOwner) Ownable(_initialOwner) {
        logicContract = _logicContract;
    }

    function setLogicContract(address _logicContract) onlyOwner {
        logicContract = _logicContract;
    }

    fallback(variadic args) external returns (variadic) {
        return logicContract.delegatecall(msg.sig, args);
    }
}