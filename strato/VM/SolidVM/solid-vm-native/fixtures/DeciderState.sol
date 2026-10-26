abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
}

interface GetImplContract {
    function getImplContract() public view returns (address);
}

contract record DeciderState is GetImplContract {
    address public owner;
    address public currentFeeContract = address(this);

    constructor(address _owner) {
        owner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    function upateOwner(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Cannot set owner to zero address");
        require(_newOwner != owner, "Should set new owner as different from current owner");
        owner = _newOwner;
    }

    function getImplContract() public view override returns (address) {
        return currentFeeContract;
    }

    function updatePayFeeContract(address _newFeeContract) external onlyOwner {
        require(_newFeeContract != address(0), "Cannot set contract address to zero address");
        currentFeeContract = _newFeeContract;
    }

    function payFees() external {
        uint oneDollar = 1e18;
        address voucher = address(0x000000000000000000000000000000000000100e);
        address USDST = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
        address validatorPool = address(0x100d); // FeeCollector address
        try { // try to use a voucher
            voucher.call("burn", address(this), 1000000000000000000);
        } catch { // if no voucher, pay in USDST
            ERC20_Template(USDST).transfer(validatorPool, oneDollar / 100);
        }
    }
}
