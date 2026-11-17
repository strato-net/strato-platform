import "../../concrete/Proxy/Proxy.sol";

// A minimal ledger token (stands in for any ERC20).
contract Coin {
    mapping(address => uint) public balanceOf;
    function mint(address to, uint amount) public { balanceOf[to] += amount; }
    function transfer(address to, uint amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint amount) public returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// Logic contract run behind the platform Proxy.
contract VaultLogic is Ownable {
    Coin public coin;
    uint public totalDeposits;
    mapping(address => uint) public deposits;
    uint[] public history;

    constructor() Ownable(msg.sender) { }

    function setCoin(address c) public { coin = Coin(c); }

    function deposit(uint amount) public {
        coin.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        totalDeposits += amount;
    }

    // No "amount > 0" check: bounded only by the caller's own deposit.
    function withdraw(uint amount) public {
        require(amount <= deposits[msg.sender], "over balance");
        deposits[msg.sender] -= amount;
        totalDeposits -= amount;
        coin.transfer(msg.sender, amount);
    }

    function sumAndClear(uint[] xs) public returns (uint) {
        uint s = 0;
        for (uint i = 0; i < xs.length; i++) {
            s += xs[i];
            xs[i] = 0;          // writes into its own (memory) parameter
        }
        return s;
    }
}

interface IVault {
    function deposit(uint amount) external;
    function withdraw(uint amount) external;
    function setCoin(address c) external;
    function totalDeposits() external returns (uint);
    function deposits(address a) external returns (uint);
    function sumAndClear(uint[] xs) external returns (uint);
}

contract Attacker {
    uint public totalDeposits;      // never written: reads as a reference to the path "totalDeposits"
    address vault;
    constructor(address _vault) { vault = _vault; }

    function attack() public {
        hop(totalDeposits);
    }
    // msg.data here is variadic([x]): one level of nesting survives the splice at the call site
    function hop(variadic x) internal {
        address(vault).call("withdraw", msg.data);
    }

    function attackArray() public returns (uint) {
        return address(vault).call("sumAndClear", variadic(totalDeposits), variadic(totalDeposits));
    }
    function hopArr(variadic x) internal returns (uint) {
        return address(vault).call("sumAndClear", msg.data);
    }
    function attackArray2() public returns (uint) {
        return hopArr(variadic(totalDeposits));
    }
}

contract Honest {
    function go(address coin, address vault, uint amount) public {
        IVault(vault).deposit(amount);
    }
}

contract Describe_PhantomProxy {
    Coin coin;
    VaultLogic logic;
    Proxy proxy;
    IVault vault;
    Honest honest;
    Attacker attacker;

    function beforeEach() public {
        coin = new Coin();
        logic = new VaultLogic();
        proxy = new Proxy(address(logic), address(this));
        vault = IVault(address(proxy));
        vault.setCoin(address(coin));
        honest = new Honest();
        coin.mint(address(honest), 1000000);
        honest.go(address(coin), address(proxy), 1000000);
        attacker = new Attacker(address(proxy));
    }

    function it_setup_is_sane() public {
        require(vault.totalDeposits() == 1000000, "totalDeposits=" + string(vault.totalDeposits()));
        require(coin.balanceOf(address(proxy)) == 1000000, "vault coin=" + string(coin.balanceOf(address(proxy))));
        require(coin.balanceOf(address(attacker)) == 0, "attacker starts with coins");
    }

    // Safe behaviour: an account with no deposit cannot take coins out of the vault.
    function it_account_with_no_deposit_cannot_withdraw() public {
        try { attacker.attack(); } catch { }
        require(coin.balanceOf(address(attacker)) == 0,
            "attacker with zero deposit withdrew " + string(coin.balanceOf(address(attacker))) + " coins; vault now holds " + string(coin.balanceOf(address(proxy))));
    }

    // Safe behaviour: writing into an array parameter must not change contract storage.
    function it_array_param_writes_do_not_touch_storage() public {
        uint r = 0;
        try { r = attacker.attackArray2(); } catch { }
        require(vault.totalDeposits() == 1000000,
            "totalDeposits was overwritten through an array parameter: now " + string(vault.totalDeposits()) + ", call returned " + string(r));
    }
}
