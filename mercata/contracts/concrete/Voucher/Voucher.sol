import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record Voucher is ERC20, Ownable {

    constructor() Ownable(msg.sender) {}

    /// @dev initializable only once
    function initialize(string name_, string symbol_) external onlyOwner {
        __ERC20_init(name_, symbol_);
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