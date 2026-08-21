import "../../concrete/Staking/FeeRouter.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

contract record MockGovernance {
    address public stakingContract;
    function setStakingContract(address s) public { stakingContract = s; }
}

contract record MockStaking {
    uint public proposerFeeBps;
    uint public processed;
    bool public revertOnProcess;
    function setProposerFeeBps(uint bps) public { proposerFeeBps = bps; }
    function setRevertOnProcess(bool r) public { revertOnProcess = r; }
    function processBlock() external {
        require(!revertOnProcess, "MockStaking: boom");
        processed += 1;
    }
}

contract record MockVoucher {
    mapping(address => uint) public balances;
    function mint(address to, uint amount) public { balances[to] += amount; }
    function burn(address from, uint amount) public {
        require(balances[from] >= amount, "no voucher");
        balances[from] -= amount;
    }
}

// The router reads its addresses through internal getters; the harness serves them
// from storage. Because SolidVM storage is name-keyed, a Signer that *is* a harness
// and DELEGATECALLs the router runs the router's code against its own addresses —
// exactly the signer-context execution the platform performs for payFees.
contract record FeeRouterHarness is FeeRouter {
    address public voucherAddr;
    address public usdstAddr;
    address public feeCollectorAddr;
    address public governanceAddr;

    function configure(address v, address u, address f, address g) public {
        voucherAddr = v;
        usdstAddr = u;
        feeCollectorAddr = f;
        governanceAddr = g;
    }

    function _voucher() internal view override returns (address) { return voucherAddr; }
    function _usdst() internal view override returns (address) { return usdstAddr; }
    function _feeCollector() internal view override returns (address) { return feeCollectorAddr; }
    function _governance() internal view override returns (address) { return governanceAddr; }
}

contract record Signer is FeeRouterHarness {
    function pay(address router) public {
        address(router).delegatecall("payFees");
    }
}

contract Describe_FeeRouter {
    TokenFactory factory;
    Token usdst;
    MockGovernance gov;
    MockStaking staking;
    MockVoucher voucher;
    FeeRouterHarness router;
    Signer signer;
    User feeCollector;

    function beforeAll() public {
        feeCollector = new User();
    }

    function beforeEach() public {
        factory = new TokenFactory(address(this));
        usdst = Token(factory.createTokenWithInitialOwner("USDST", "USDST Token", new string[](0), new string[](0), new string[](0), "USDST", 0, 18, address(this)));
        usdst.setStatus(2);

        gov = new MockGovernance();
        staking = new MockStaking();
        voucher = new MockVoucher();
        router = new FeeRouterHarness();
        signer = new Signer();
        signer.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        usdst.mint(address(signer), 1e18);
    }

    function it_sends_the_whole_fee_to_the_collector_without_staking() public {
        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "collector got $0.01");
        require(usdst.balanceOf(address(signer)) == 1e18 - 1e16, "signer paid");
        require(staking.processed() == 0, "no staking to notify");
    }

    function it_splits_the_fee_and_notifies_staking() public {
        gov.setStakingContract(address(staking));
        staking.setProposerFeeBps(5000);

        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 5e15, "collector half");
        require(usdst.balanceOf(address(staking)) == 5e15, "staking half");
        require(staking.processed() == 1, "processBlock called");

        staking.setProposerFeeBps(20000);
        signer.pay(address(router));
        require(usdst.balanceOf(address(staking)) == 5e15 + 1e16, "share capped at 100%");
        require(usdst.balanceOf(address(feeCollector)) == 5e15, "collector unchanged");
    }

    function it_still_notifies_staking_on_the_voucher_path() public {
        gov.setStakingContract(address(staking));
        voucher.mint(address(signer), 1e18);

        signer.pay(address(router));
        require(voucher.balances(address(signer)) == 0, "voucher burned");
        require(usdst.balanceOf(address(feeCollector)) == 0, "no USDST charged");
        require(staking.processed() == 1, "processBlock still called");
    }

    function it_swallows_process_block_failures() public {
        gov.setStakingContract(address(staking));
        staking.setRevertOnProcess(true);

        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "fee paid although processBlock reverted");
    }

    function it_reverts_when_the_signer_cannot_pay() public {
        Signer broke = new Signer();
        broke.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        bool reverted = false;
        try broke.pay(address(router)) {
        } catch {
            reverted = true;
        }
        require(reverted, "unpaid fee fails the transaction");
    }
}
