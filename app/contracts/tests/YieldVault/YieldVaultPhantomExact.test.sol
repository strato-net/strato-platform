import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/YieldVault/YieldVault.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

// Attacker with no assets and no shares. It first PLANTS the amount it wants in the vault's own storage
// with a free approve() on the vault's share token (writes _allowances[attacker][spender] = V), then
// passes a reference to that slot as `assets`.
contract Attacker {
    mapping(address => mapping(address => uint)) _allowances;   // never written here
    address vault;
    constructor(address _vault) { vault = _vault; }

    function attack(uint amount) public {
        address(vault).call("approve", address(0xbeef), amount);          // plant V in the vault's storage
        hop(_allowances[address(this)][address(0xbeef)], address(this), address(this));
    }
    function hop(variadic x) internal { address(vault).call("withdraw", msg.data); }
}

contract Describe_YieldVaultPhantomExact {
    uint public INFINITY = 2 ** 256 - 1;
    Mercata m;
    YieldVault vault;
    address asset;
    User honest;
    Attacker attacker;

    function beforeAll() public { m = new Mercata(); }

    function beforeEach() public {
        (bool executed, variadic ret) = m.adminRegistry().castVoteOnIssue(address(m.tokenFactory()), "createToken", "ETH", "Wrapped ETH", [], [], [], "ETH", 0, 18);
        asset = address(ret);
        m.adminRegistry().castVoteOnIssue(asset, "setStatus", 2);
        address impl = address(new YieldVault(address(this)));
        vault = YieldVault(address(new Proxy(impl, address(this))));
        vault.initialize(asset, "ETH Carry Vault", "carryETH");

        honest = new User();
        m.adminRegistry().castVoteOnIssue(asset, "mint", address(honest), 1000e18);
        honest.do(asset, "approve", address(vault), INFINITY);
        honest.do(address(vault), "deposit(uint256,address)", 1000e18, address(honest));

        attacker = new Attacker(address(vault));
    }

    // Safe behaviour: an account with no shares cannot withdraw any assets, whatever amount it names.
    function it_account_without_shares_cannot_withdraw_a_chosen_amount() public {
        require(vault.balanceOf(address(attacker)) == 0 && IERC20(asset).balanceOf(address(attacker)) == 0, "attacker starts with nothing");
        try { attacker.attack(777e18); } catch { }
        uint stolen = IERC20(asset).balanceOf(address(attacker));
        require(stolen == 0, "attacker with zero shares withdrew exactly " + string(stolen) + " (the amount it chose); vault now holds " + string(IERC20(asset).balanceOf(address(vault))) + "; attacker shares " + string(vault.balanceOf(address(attacker))));
    }
}
