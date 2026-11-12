import "../../concrete/Admin/MultisigFactory.sol";
import "../../concrete/Admin/MultisigLogic.sol";
import "../../concrete/Proxy/Proxy.sol";

contract GovernanceSigner {
    function invoke(address _target, string _function, variadic _arguments) public returns (variadic) {
        return _target.call(_function, _arguments);
    }
}

contract GovernanceToken {
    mapping (address => uint) public balanceOf;

    constructor(address _holder) {
        balanceOf[_holder] = 1000;
    }

    function transfer(address _to, uint _amount) public {
        require(balanceOf[msg.sender] >= _amount, "Insufficient balance");
        balanceOf[msg.sender] -= _amount;
        balanceOf[_to] += _amount;
    }
}

contract Describe_MultisigGovernance {
    MultisigFactory factory;
    MultisigLogic logic;
    GovernanceSigner a;
    GovernanceSigner b;
    GovernanceSigner c;
    GovernanceSigner d;
    GovernanceSigner outsider;

    function beforeEach() {
        logic = new MultisigLogic();
        MultisigFactory implementation = new MultisigFactory(address(0xdeadbeef));
        factory = MultisigFactory(address(new Proxy(address(implementation), address(this))));
        factory.initializeRegistryGovernance(address(this));
        factory.publishLogicVersion("1", address(logic));
        a = new GovernanceSigner();
        b = new GovernanceSigner();
        c = new GovernanceSigner();
        d = new GovernanceSigner();
        outsider = new GovernanceSigner();
    }

    function deploy(uint _timelock) internal returns (address) {
        string setupHash = factory.registerSetup(
            [address(a), address(b), address(c)],
            2,
            _timelock,
            "1",
            "governance"
        );
        a.invoke(address(factory), "confirmSetup", setupHash);
        b.invoke(address(factory), "confirmSetup", setupHash);
        return c.invoke(address(factory), "confirmSetup", setupHash);
    }

    function deployThreeOfFour(uint _timelock) internal returns (address) {
        string setupHash = factory.registerSetup(
            [address(a), address(b), address(c), address(d)],
            3,
            _timelock,
            "1",
            "three-of-four"
        );
        a.invoke(address(factory), "confirmSetup", setupHash);
        b.invoke(address(factory), "confirmSetup", setupHash);
        c.invoke(address(factory), "confirmSetup", setupHash);
        return d.invoke(address(factory), "confirmSetup", setupHash);
    }

    function rejects(GovernanceSigner _caller, address _target, string _function, variadic _arguments) internal returns (bool) {
        try _caller.invoke(_target, _function, _arguments) {
            return false;
        } catch {
            return true;
        }
    }

    function it_executes_only_after_m_distinct_approvals() {
        address wallet = deploy(0);
        GovernanceToken token = new GovernanceToken(wallet);
        string issueId = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(token.balanceOf(address(outsider)) == 0, "One signer executed issue");
        require(
            rejects(a, wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Duplicate approval accepted"
        );
        b.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(token.balanceOf(address(outsider)) == 100, "Approved issue did not execute");
        require(
            rejects(c, wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Executed issue was replayed"
        );
    }

    function it_assigns_unique_ids_to_identical_actions() {
        address wallet = deploy(0);
        GovernanceToken token = new GovernanceToken(wallet);
        string first = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        string second = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(first != second, "Identical actions reused an issue ID");
    }

    function it_enforces_the_transaction_timelock_and_execution_window() {
        address wallet = deploy(100);
        GovernanceToken token = new GovernanceToken(wallet);
        string issueId = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        b.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(
            rejects(c, wallet, "executeIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Issue executed before timelock"
        );
        fastForward(100);
        c.invoke(wallet, "executeIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(token.balanceOf(address(outsider)) == 100, "Queued issue did not execute");
    }

    function it_cancels_a_queued_issue_with_quorum_without_waiting_the_timelock() {
        address wallet = deploy(100);
        GovernanceToken token = new GovernanceToken(wallet);
        string targetIssue = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        b.invoke(wallet, "approveIssue", targetIssue, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        string cancelIssue = a.invoke(wallet, "proposeIssue", wallet, "cancelIssue", ["string"], targetIssue);
        b.invoke(wallet, "approveIssue", cancelIssue, wallet, "cancelIssue", ["string"], targetIssue);
        fastForward(100);
        require(
            rejects(c, wallet, "executeIssue", targetIssue, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Cancelled queued issue executed"
        );
        require(token.balanceOf(address(outsider)) == 0, "Cancelled issue moved funds");
    }

    function it_prevents_the_creator_dismissing_after_another_signer_approves() {
        address wallet = deployThreeOfFour(100);
        GovernanceToken token = new GovernanceToken(wallet);
        string issueId = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        b.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(rejects(a, wallet, "dismissIssue", issueId), "Creator dismissed another signer's approval");
    }

    function it_allows_the_creator_to_dismiss_after_revoking_the_only_approval() {
        address wallet = deploy(100);
        GovernanceToken token = new GovernanceToken(wallet);
        string issueId = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        a.invoke(wallet, "revokeIssueApproval", issueId);
        a.invoke(wallet, "dismissIssue", issueId);
        (,,,,,,,,,,, bool active) = MultisigLogic(wallet).issues(issueId);
        require(!active, "Zero-approval issue remained active");
    }

    function it_invalidates_every_old_issue_when_configuration_changes() {
        address wallet = deploy(0);
        GovernanceToken token = new GovernanceToken(wallet);
        string staleIssue = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        string configIssue = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "applyConfiguration",
            ["address[]", "uint256"],
            [address(a), address(b), address(c)],
            2
        );
        b.invoke(
            wallet,
            "approveIssue",
            configIssue,
            wallet,
            "applyConfiguration",
            ["address[]", "uint256"],
            [address(a), address(b), address(c)],
            2
        );
        require(
            rejects(b, wallet, "approveIssue", staleIssue, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Old issue survived epoch change"
        );
    }

    function it_requires_nominee_control_before_adding_a_signer() {
        address wallet = deploy(0);
        string issueId = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "nominateConfiguration",
            ["address", "address[]", "uint256"],
            address(d),
            [address(a), address(b), address(c), address(d)],
            2
        );
        b.invoke(
            wallet,
            "approveIssue",
            issueId,
            wallet,
            "nominateConfiguration",
            ["address", "address[]", "uint256"],
            address(d),
            [address(a), address(b), address(c), address(d)],
            2
        );
        require(MultisigLogic(wallet).signerMap(address(d)) == 0, "Nominee activated without acceptance");
        require(rejects(outsider, wallet, "acceptNomination"), "Wrong account accepted nomination");
        d.invoke(wallet, "acceptNomination");
        require(MultisigLogic(wallet).signerMap(address(d)) > 0, "Nominee did not activate");
    }

    function it_applies_the_old_timelock_to_timelock_changes() {
        address wallet = deploy(100);
        string issueId = a.invoke(wallet, "proposeIssue", wallet, "setTransactionTimelock", ["uint256"], 0);
        b.invoke(wallet, "approveIssue", issueId, wallet, "setTransactionTimelock", ["uint256"], 0);
        require(MultisigLogic(wallet).transactionTimelock() == 100, "Timelock changed before old delay");
        fastForward(100);
        c.invoke(wallet, "executeIssue", issueId, wallet, "setTransactionTimelock", ["uint256"], 0);
        require(MultisigLogic(wallet).transactionTimelock() == 0, "Timelock did not change");
    }

    function it_expires_unapproved_issues_and_allows_recreation() {
        address wallet = deploy(0);
        GovernanceToken token = new GovernanceToken(wallet);
        string expired = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        fastForward(2592001);
        require(
            rejects(b, wallet, "approveIssue", expired, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Expired issue accepted approval"
        );
        string replacement = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(replacement != expired, "Recreated issue reused its ID");
        b.invoke(wallet, "approveIssue", replacement, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(token.balanceOf(address(outsider)) == 100, "Replacement issue did not execute");
    }

    function it_expires_pending_nominations() {
        address wallet = deploy(0);
        string issueId = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "nominateConfiguration",
            ["address", "address[]", "uint256"],
            address(d),
            [address(a), address(b), address(c), address(d)],
            2
        );
        b.invoke(
            wallet,
            "approveIssue",
            issueId,
            wallet,
            "nominateConfiguration",
            ["address", "address[]", "uint256"],
            address(d),
            [address(a), address(b), address(c), address(d)],
            2
        );
        fastForward(2592001);
        require(rejects(d, wallet, "acceptNomination"), "Expired nomination was accepted");
    }
}
