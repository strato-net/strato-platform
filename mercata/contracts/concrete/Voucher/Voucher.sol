contract record Voucher is ERC20, Ownable {
    
    constructor(
        string _name,
        string _symbol
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        return false;
    }

    function allowance(address owner, address spender) public view override returns (uint256) {
        return 0;
    }

    function approve(address spender, uint256 value) public override returns (bool) {
        return false;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        return false;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    function decimals() external view override returns (uint8) {
        return 18;
    }
}