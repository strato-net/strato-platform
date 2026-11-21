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

    function it_ends_the_waiting_period_when_an_approval_is_withdrawn() {
        address wallet = deploy(100);
        GovernanceToken token = new GovernanceToken(wallet);
        string issueId = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        b.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        fastForward(60);
        require(rejects(c, wallet, "revokeIssueApproval", issueId), "A signer who had not approved withdrew");
        b.invoke(wallet, "revokeIssueApproval", issueId);
        fastForward(100);
        require(
            rejects(a, wallet, "executeIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Issue executed after falling below quorum"
        );

        c.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        fastForward(60);
        require(
            rejects(a, wallet, "executeIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Restored issue did not wait a fresh timelock"
        );
        fastForward(40);
        a.invoke(wallet, "executeIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(token.balanceOf(address(outsider)) == 100, "Restored issue did not execute");
    }

    function it_lets_one_approver_stop_a_queued_issue_in_a_three_of_four() {
        address wallet = deployThreeOfFour(100);
        GovernanceToken token = new GovernanceToken(wallet);
        string issueId = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        b.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        c.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        c.invoke(wallet, "revokeIssueApproval", issueId);
        fastForward(100);
        require(
            rejects(a, wallet, "executeIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Two of four executed a three-of-four issue"
        );
        require(token.balanceOf(address(outsider)) == 0, "Stopped issue moved funds");
    }

    function it_lets_a_signer_approve_again_after_withdrawing() {
        address wallet = deploy(100);
        GovernanceToken token = new GovernanceToken(wallet);
        string issueId = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        b.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        b.invoke(wallet, "revokeIssueApproval", issueId);
        b.invoke(wallet, "approveIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        fastForward(100);
        a.invoke(wallet, "executeIssue", issueId, address(token), "transfer", ["address", "uint256"], address(outsider), 100);
        require(token.balanceOf(address(outsider)) == 100, "Re-approved issue did not execute");
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
        string configIssue = a.invoke(wallet, "proposeIssue", wallet, "setRequiredApprovals", ["uint256"], 2);
        b.invoke(wallet, "approveIssue", configIssue, wallet, "setRequiredApprovals", ["uint256"], 2);
        require(
            rejects(b, wallet, "approveIssue", staleIssue, address(token), "transfer", ["address", "uint256"], address(outsider), 100),
            "Old issue survived epoch change"
        );
    }

    function it_requires_nominee_control_before_adding_a_signer() {
        address wallet = deploy(0);
        string issueId = a.invoke(wallet, "proposeIssue", wallet, "nominateSigner", ["address"], address(d));
        b.invoke(wallet, "approveIssue", issueId, wallet, "nominateSigner", ["address"], address(d));
        require(MultisigLogic(wallet).signerMap(address(d)) == 0, "Nominee activated without acceptance");
        require(rejects(outsider, wallet, "acceptNomination"), "Wrong account accepted nomination");
        d.invoke(wallet, "acceptNomination");
        require(MultisigLogic(wallet).signerMap(address(d)) == 4, "Nominee did not activate");
    }

    function it_adds_only_the_nominee_and_keeps_required_approvals() {
        address wallet = deploy(0);
        uint indexA = MultisigLogic(wallet).signerMap(address(a));
        uint indexB = MultisigLogic(wallet).signerMap(address(b));
        uint indexC = MultisigLogic(wallet).signerMap(address(c));
        string issueId = a.invoke(wallet, "proposeIssue", wallet, "nominateSigner", ["address"], address(d));
        b.invoke(wallet, "approveIssue", issueId, wallet, "nominateSigner", ["address"], address(d));
        d.invoke(wallet, "acceptNomination");
        require(MultisigLogic(wallet).signerMap(address(a)) == indexA, "Existing signer changed");
        require(MultisigLogic(wallet).signerMap(address(b)) == indexB, "Existing signer changed");
        require(MultisigLogic(wallet).signerMap(address(c)) == indexC, "Existing signer changed");
        require(MultisigLogic(wallet).signers(3) == address(d), "Nominee was not appended");
        require(MultisigLogic(wallet).requiredApprovals() == 2, "Adding a signer changed required approvals");
        require(MultisigLogic(wallet).multisigHealthCheck(), "Signer set is inconsistent");
        require(rejects(d, wallet, "acceptNomination"), "Nomination was accepted twice");
    }

    function it_rejects_nominating_a_signer_or_the_wallet() {
        address wallet = deploy(0);
        string existing = a.invoke(wallet, "proposeIssue", wallet, "nominateSigner", ["address"], address(c));
        require(
            rejects(b, wallet, "approveIssue", existing, wallet, "nominateSigner", ["address"], address(c)),
            "Existing signer was nominated"
        );
        string self = a.invoke(wallet, "proposeIssue", wallet, "nominateSigner", ["address"], wallet);
        require(
            rejects(b, wallet, "approveIssue", self, wallet, "nominateSigner", ["address"], wallet),
            "Wallet was nominated as its own signer"
        );
    }

    function it_keeps_only_the_latest_nomination_open() {
        address wallet = deploy(0);
        string first = a.invoke(wallet, "proposeIssue", wallet, "nominateSigner", ["address"], address(d));
        b.invoke(wallet, "approveIssue", first, wallet, "nominateSigner", ["address"], address(d));
        string second = a.invoke(wallet, "proposeIssue", wallet, "nominateSigner", ["address"], address(outsider));
        b.invoke(wallet, "approveIssue", second, wallet, "nominateSigner", ["address"], address(outsider));
        require(rejects(d, wallet, "acceptNomination"), "Replaced nomination was accepted");
        outsider.invoke(wallet, "acceptNomination");
        require(MultisigLogic(wallet).signerMap(address(outsider)) == 4, "Latest nominee did not activate");
    }

    function removeAndCheck(GovernanceSigner _removed) internal {
        address wallet = deployThreeOfFour(0);
        address removed = address(_removed);
        uint removedIndex = MultisigLogic(wallet).signerMap(removed);
        address last = MultisigLogic(wallet).signers(3);
        address[] all = [address(a), address(b), address(c), address(d)];
        uint[] expected = [uint(0), 0, 0, 0];
        for (uint i = 0; i < all.length; i++) {
            expected[i] = all[i] == removed ? 0
                : all[i] == last ? removedIndex
                : MultisigLogic(wallet).signerMap(all[i]);
        }

        string issueId = a.invoke(wallet, "proposeIssue", wallet, "removeSigner", ["address", "uint256"], removed, 2);
        b.invoke(wallet, "approveIssue", issueId, wallet, "removeSigner", ["address", "uint256"], removed, 2);
        c.invoke(wallet, "approveIssue", issueId, wallet, "removeSigner", ["address", "uint256"], removed, 2);

        for (uint j = 0; j < all.length; j++) {
            require(MultisigLogic(wallet).signerMap(all[j]) == expected[j], "Signer index is wrong after removal");
            if (expected[j] > 0) {
                require(MultisigLogic(wallet).signers(expected[j] - 1) == all[j], "Signer list is wrong after removal");
            }
        }
        require(MultisigLogic(wallet).requiredApprovals() == 2, "Required approvals were not set");
        require(MultisigLogic(wallet).multisigHealthCheck(), "Signer set is inconsistent");
        require(rejects(_removed, wallet, "proposeIssueNoArgs", wallet, "cancelUpgrade"), "Removed signer proposed");
    }

    function it_removes_any_one_signer_and_keeps_indexes_consistent() {
        removeAndCheck(a);
        removeAndCheck(b);
        removeAndCheck(c);
        removeAndCheck(d);
    }

    function it_adds_a_signer_back_after_removal_with_clean_indexes() {
        address wallet = deployThreeOfFour(0);
        string removal = a.invoke(wallet, "proposeIssue", wallet, "removeSigner", ["address", "uint256"], address(b), 2);
        b.invoke(wallet, "approveIssue", removal, wallet, "removeSigner", ["address", "uint256"], address(b), 2);
        c.invoke(wallet, "approveIssue", removal, wallet, "removeSigner", ["address", "uint256"], address(b), 2);
        string nomination = a.invoke(wallet, "proposeIssue", wallet, "nominateSigner", ["address"], address(b));
        c.invoke(wallet, "approveIssue", nomination, wallet, "nominateSigner", ["address"], address(b));
        b.invoke(wallet, "acceptNomination");
        require(MultisigLogic(wallet).signerMap(address(b)) == 4, "Returning signer has the wrong index");
        require(MultisigLogic(wallet).signers(3) == address(b), "Returning signer was not appended");
        require(MultisigLogic(wallet).multisigHealthCheck(), "Signer set is inconsistent");
    }

    function it_rejects_a_removal_that_breaks_the_signer_rules() {
        address wallet = deploy(0);
        string tooFew = a.invoke(wallet, "proposeIssue", wallet, "removeSigner", ["address", "uint256"], address(c), 2);
        require(
            rejects(b, wallet, "approveIssue", tooFew, wallet, "removeSigner", ["address", "uint256"], address(c), 2),
            "Removal left fewer than three signers"
        );
        string notSigner = a.invoke(wallet, "proposeIssue", wallet, "removeSigner", ["address", "uint256"], address(d), 2);
        require(
            rejects(b, wallet, "approveIssue", notSigner, wallet, "removeSigner", ["address", "uint256"], address(d), 2),
            "Removed an account that is not a signer"
        );

        wallet = deployThreeOfFour(0);
        string allRequired = a.invoke(wallet, "proposeIssue", wallet, "removeSigner", ["address", "uint256"], address(d), 3);
        b.invoke(wallet, "approveIssue", allRequired, wallet, "removeSigner", ["address", "uint256"], address(d), 3);
        require(
            rejects(c, wallet, "approveIssue", allRequired, wallet, "removeSigner", ["address", "uint256"], address(d), 3),
            "Removal left every signer required"
        );
        require(MultisigLogic(wallet).signerMap(address(d)) > 0, "Rejected removal changed the signer set");
    }

    function it_changes_required_approvals_within_the_signer_rules() {
        address wallet = deployThreeOfFour(0);
        string all = a.invoke(wallet, "proposeIssue", wallet, "setRequiredApprovals", ["uint256"], 4);
        b.invoke(wallet, "approveIssue", all, wallet, "setRequiredApprovals", ["uint256"], 4);
        require(
            rejects(c, wallet, "approveIssue", all, wallet, "setRequiredApprovals", ["uint256"], 4),
            "Every signer became required"
        );
        string one = a.invoke(wallet, "proposeIssue", wallet, "setRequiredApprovals", ["uint256"], 1);
        b.invoke(wallet, "approveIssue", one, wallet, "setRequiredApprovals", ["uint256"], 1);
        require(
            rejects(c, wallet, "approveIssue", one, wallet, "setRequiredApprovals", ["uint256"], 1),
            "A single approval became enough"
        );
        string lower = a.invoke(wallet, "proposeIssue", wallet, "setRequiredApprovals", ["uint256"], 2);
        b.invoke(wallet, "approveIssue", lower, wallet, "setRequiredApprovals", ["uint256"], 2);
        c.invoke(wallet, "approveIssue", lower, wallet, "setRequiredApprovals", ["uint256"], 2);
        require(MultisigLogic(wallet).requiredApprovals() == 2, "Required approvals did not change");
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
            "nominateSigner",
            ["address"],
            address(d)
        );
        b.invoke(
            wallet,
            "approveIssue",
            issueId,
            wallet,
            "nominateSigner",
            ["address"],
            address(d)
        );
        fastForward(2592001);
        require(rejects(d, wallet, "acceptNomination"), "Expired nomination was accepted");
    }

    function it_revokes_a_nomination_with_quorum_without_waiting_the_timelock() {
        address wallet = deploy(100);
        string issueId = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "nominateSigner",
            ["address"],
            address(d)
        );
        b.invoke(
            wallet,
            "approveIssue",
            issueId,
            wallet,
            "nominateSigner",
            ["address"],
            address(d)
        );
        fastForward(100);
        c.invoke(
            wallet,
            "executeIssue",
            issueId,
            wallet,
            "nominateSigner",
            ["address"],
            address(d)
        );
        string revokeIssue = a.invoke(wallet, "proposeIssue", wallet, "revokeNomination", ["address"], address(d));
        b.invoke(wallet, "approveIssue", revokeIssue, wallet, "revokeNomination", ["address"], address(d));
        require(rejects(d, wallet, "acceptNomination"), "Revoked nomination was accepted");
    }
}
