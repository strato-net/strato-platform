import "../../concrete/Tokenomics/VestingWallet.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// The port keeps OpenZeppelin's linear schedule and release accounting.
contract Describe_VestingWallet {
    Token strato;
    User alice;
    User stranger;

    function beforeAll() public {
        alice = new User();
        stranger = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
    }

    function _warpTo(uint ts) internal {
        require(ts > block.timestamp, "warp target " + string(ts) + " is not after now " + string(block.timestamp));
        fastForward(ts - block.timestamp);
    }

    function it_vests_linearly_and_releases_to_the_beneficiary() public {
        uint64 s = uint64(block.timestamp + 100);
        VestingWallet w = new VestingWallet(address(alice), s, 1000);
        require(w.beneficiary() == address(alice), "beneficiary");
        require(w.start() == s && w.duration() == 1000 && w.end() == s + 1000, "span");

        strato.mint(address(w), 1000);
        require(w.vestedAmount(address(strato), s - 1) == 0, "before start");
        require(w.vestedAmount(address(strato), s + 250) == 250, "a quarter");
        require(w.vestedAmount(address(strato), s + 1000) == 1000, "at the end");

        w.release(address(strato));
        require(strato.balanceOf(address(alice)) == 0, "releasing before start pays nothing");

        _warpTo(s + 400);
        // Anyone may trigger a release; the tokens always go to the beneficiary.
        stranger.do(address(w), "release", address(strato));
        require(strato.balanceOf(address(alice)) == 400, "40%");
        require(strato.balanceOf(address(stranger)) == 0, "caller gets nothing");
        require(w.released(address(strato)) == 400, "released");

        // A late deposit follows the schedule as if it had been locked from the start.
        strato.mint(address(w), 1000);
        require(w.releasable(address(strato)) == 400, "40% of the deposit is releasable at once");

        _warpTo(s + 1000);
        w.release(address(strato));
        require(strato.balanceOf(address(alice)) == 2000, "everything at the end");
        require(strato.balanceOf(address(w)) == 0, "drained");
    }

    function it_works_as_a_timelock_with_zero_duration() public {
        uint64 s = uint64(block.timestamp + 100);
        VestingWallet w = new VestingWallet(address(alice), s, 0);
        strato.mint(address(w), 500);
        require(w.vestedAmount(address(strato), s - 1) == 0, "locked until start");
        require(w.vestedAmount(address(strato), s) == 500, "all at start");
    }

    function it_rejects_a_zero_beneficiary() public {
        try new VestingWallet(address(0), uint64(block.timestamp), 0) { revert("accepted zero beneficiary"); } catch Error(string e) {
            require(e == "VestingWallet: beneficiary is zero", e);
        }
    }
}
