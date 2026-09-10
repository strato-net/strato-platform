// ============================================================================
//  StablePool.sol - migration regression (audit finding F8).
//
//  Separate file on purpose: this suite needs a stand-in PoolFactory that
//  answers feeCollector(), and SolidVM resolves a typed external call by
//  function name across the whole code collection. A contract declaring
//  feeCollector() alongside the other audit tests hijacks StablePool's
//  `poolFactory.feeCollector()` and silently disables the protocol-fee sweep
//  everywhere in that file.
//
//  Run:  cd app/contracts/tests/Pool && solid-vm-cli test StablePoolMigration.test.sol
// ============================================================================

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

/// @dev Stands in for PoolFactory so the test can drive a pool it actually owns.
contract PoolHarness {
    function feeCollector() public returns (address) { return address(0); }

    function makePool(address t0, address t1, address lpAddr) public returns (StablePool) {
        StablePool p = new StablePool(address(this));   // owner = this, and
        p.initialize(                                   // poolFactory = msg.sender = this
            100, 30000000, 1e10, 866,
            [t0, t1], [uint(1e18), uint(1e18)], [uint(1), uint(1)],
            [address(0), address(0)], lpAddr
        );
        return p;
    }

    function migrate(StablePool p, address receiver) public {
        p.migrateAllTokens(receiver);
    }
}

contract Describe_StablePool_Migration is Authorizable {

    Mercata m;
    string[] emptyArray;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);
    }

    function newToken(string name, string sym) internal returns (address) {
        address t = m.tokenFactory().createToken(
            name, "audit token", emptyArray, emptyArray, emptyArray, sym, 100000000000e18, 18
        );
        Token(t).setStatus(2); // ACTIVE
        Token(t).mint(address(this), 10000000000e18);
        return t;
    }

    function it_f8_migration_locks_the_drained_pool() {
        address t0 = newToken("Audit M0", "AUDM0");
        address t1 = newToken("Audit M1", "AUDM1");
        address lpAddr = m.tokenFactory().createTokenWithInitialOwner(
            "Audit LP", "lp", emptyArray, emptyArray, emptyArray, "AUDLP", 0, 18, address(this)
        );
        fastForward(100);

        PoolHarness harness = new PoolHarness();
        StablePool p = harness.makePool(t0, t1, lpAddr);
        Ownable(lpAddr).transferOwnership(address(p));

        ERC20(t0).approve(address(p), 10000000000e18);
        ERC20(t1).approve(address(p), 10000000000e18);
        uint minted = p.addLiquidityGeneral([uint(100000e18), uint(100000e18)], 1, address(0));

        harness.migrate(p, address(0xdead));

        require(ERC20(t0).balanceOf(address(0xdead)) == 100000e18, "F8: coins moved to the destination");
        require(p.isDisabled(), "F8: the emptied pool is locked");
        require(p.isPaused(), "F8: ...and paused");
        require(ERC20(lpAddr).totalSupply() == minted + 1000, "F8: supply (incl. locked MINIMUM_LIQUIDITY) left readable for the re-mint");

        // nothing can trade or withdraw against the emptied reserve
        bool traded = false;
        try p.exchange(0, 1, 1e18, 1, address(0)) { traded = true; } catch { traded = false; }
        require(!traded, "F8: swaps blocked after migration");

        bool migratedTwice = false;
        try harness.migrate(p, address(0xdead)) { migratedTwice = true; } catch { migratedTwice = false; }
        require(!migratedTwice, "F8: migration cannot be replayed");
    }
}
