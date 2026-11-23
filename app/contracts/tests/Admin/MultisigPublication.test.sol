import "../../concrete/Admin/MultisigFactory.sol";
import "../../concrete/Admin/MultisigLogic.sol";
import "../../concrete/Proxy/Proxy.sol";
import "./published/MultisigFactoryV1.sol";
import "./published/MultisigLogicV1.sol";

contract PublicationSigner {
    function invoke(address _target, string _function, variadic _arguments) public returns (variadic) {
        return _target.call(_function, _arguments);
    }
}

contract PublicationToken {
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

contract PublicationUpgradeTrigger {
    function trigger(address _wallet) public {
        MultisigWallet(_wallet).executeUpgrade();
    }
}

/**
 * Release check for a rules version. Run it before the publish vote: it proves a wallet
 * created on the candidate, and a wallet upgraded to it from the published version, can
 * still do everything. Point `candidate` at the version being published.
 */
contract Describe_MultisigPublication {
    uint constant TIMELOCK = 100;
    uint constant UPGRADE_DELAY = 604800;

    MultisigFactory factory;
    MultisigFactory publishedFactory;
    address candidate;
    address successor;
    PublicationSigner a;
    PublicationSigner b;
    PublicationSigner c;
    PublicationSigner d;
    PublicationSigner e;
    PublicationSigner f;
    PublicationSigner outsider;

    function beforeEach() {
        candidate = address(new MultisigLogic());
        MultisigFactory implementation = new MultisigFactory(address(0xdeadbeef));
        factory = MultisigFactory(address(new Proxy(address(implementation), address(this))));
        factory.initializeRegistryGovernance(address(this));
        factory.publishLogicVersion("1", address(new MultisigLogicV1()));
        factory.publishLogicVersion("2", candidate);
        factory.setUpgradePath("1", "2", true);
        // A later version, only so a wallet on the candidate has an upgrade to refuse.
        successor = address(new MultisigLogic());
        factory.publishLogicVersion("3", successor);
        factory.setUpgradePath("2", "3", true);
        // The registry logic and wallet shell as published, for wallets created before this one.
        MultisigFactoryV1 publishedImplementation = new MultisigFactoryV1(address(0xdeadbeef));
        publishedFactory = MultisigFactory(address(new Proxy(address(publishedImplementation), address(this))));
        publishedFactory.initializeRegistryGovernance(address(this));
        publishedFactory.publishLogicVersion("1", address(new MultisigLogicV1()));
        publishedFactory.publishLogicVersion("2", candidate);
        publishedFactory.setUpgradePath("1", "2", true);
        a = new PublicationSigner();
        b = new PublicationSigner();
        c = new PublicationSigner();
        d = new PublicationSigner();
        e = new PublicationSigner();
        f = new PublicationSigner();
        outsider = new PublicationSigner();
    }

    function deploy(MultisigFactory _registry, string _version) internal returns (address) {
        string setupHash = _registry.registerSetup([address(a), address(b), address(c)], 2, TIMELOCK, _version, "publication");
        a.invoke(address(_registry), "confirmSetup", setupHash);
        b.invoke(address(_registry), "confirmSetup", setupHash);
        return c.invoke(address(_registry), "confirmSetup", setupHash);
    }

    function upgrade(address _wallet, address _logic, string _version) internal {
        string[] types = ["address", "string", "string"];
        string id = a.invoke(_wallet, "proposeIssue", _wallet, "scheduleUpgrade", types, _logic, _version, "");
        b.invoke(_wallet, "approveIssue", id, _wallet, "scheduleUpgrade", types, _logic, _version, "");
        fastForward(TIMELOCK);
        a.invoke(_wallet, "executeIssue", id, _wallet, "scheduleUpgrade", types, _logic, _version, "");
        fastForward(UPGRADE_DELAY);
    }

    /// @dev The shell reads the candidate's executing flag by name. A candidate that renamed it
    ///      would let an upgrade be applied in the middle of an issue.
    function requireUpgradeIsRefusedDuringAnIssue(address _wallet) internal {
        upgrade(_wallet, successor, "3");
        PublicationUpgradeTrigger trigger = new PublicationUpgradeTrigger();
        string id = a.invoke(_wallet, "proposeIssue", address(trigger), "trigger", ["address"], _wallet);
        b.invoke(_wallet, "approveIssue", id, address(trigger), "trigger", ["address"], _wallet);
        fastForward(TIMELOCK);
        require(
            rejects(a, _wallet, "executeIssue", id, address(trigger), "trigger", ["address"], _wallet),
            "Upgrade applied in the middle of an issue"
        );
        require(MultisigWallet(_wallet).multisigCurrentVersion() == "2", "Version changed in the middle of an issue");
        string cancellation = a.invoke(_wallet, "proposeIssueNoArgs", _wallet, "cancelUpgrade");
        b.invoke(_wallet, "approveIssueNoArgs", cancellation, _wallet, "cancelUpgrade");
    }

    function rejects(PublicationSigner _caller, address _target, string _function, variadic _arguments) internal returns (bool) {
        try _caller.invoke(_target, _function, _arguments) {
            return false;
        } catch {
            return true;
        }
    }

    // Each helper proposes as `a`, collects the approvals the wallet needs, waits out its
    // timelock and executes: one helper per argument shape, so payloads stay literal.
    function passAddress(address _wallet, string _function, address _value) internal {
        bool third = MultisigLogic(_wallet).requiredApprovals() == 3;
        uint wait = MultisigLogic(_wallet).transactionTimelock();
        string id = a.invoke(_wallet, "proposeIssue", _wallet, _function, ["address"], _value);
        b.invoke(_wallet, "approveIssue", id, _wallet, _function, ["address"], _value);
        if (third) c.invoke(_wallet, "approveIssue", id, _wallet, _function, ["address"], _value);
        if (wait > 0) {
            fastForward(wait);
            a.invoke(_wallet, "executeIssue", id, _wallet, _function, ["address"], _value);
        }
    }

    function passUint(address _wallet, string _function, uint _value) internal {
        bool third = MultisigLogic(_wallet).requiredApprovals() == 3;
        uint wait = MultisigLogic(_wallet).transactionTimelock();
        string id = a.invoke(_wallet, "proposeIssue", _wallet, _function, ["uint256"], _value);
        b.invoke(_wallet, "approveIssue", id, _wallet, _function, ["uint256"], _value);
        if (third) c.invoke(_wallet, "approveIssue", id, _wallet, _function, ["uint256"], _value);
        if (wait > 0) {
            fastForward(wait);
            a.invoke(_wallet, "executeIssue", id, _wallet, _function, ["uint256"], _value);
        }
    }

    function passAddressUint(address _wallet, address _target, string _function, address _first, uint _second) internal {
        bool third = MultisigLogic(_wallet).requiredApprovals() == 3;
        uint wait = MultisigLogic(_wallet).transactionTimelock();
        string id = a.invoke(_wallet, "proposeIssue", _target, _function, ["address", "uint256"], _first, _second);
        b.invoke(_wallet, "approveIssue", id, _target, _function, ["address", "uint256"], _first, _second);
        if (third) c.invoke(_wallet, "approveIssue", id, _target, _function, ["address", "uint256"], _first, _second);
        if (wait > 0) {
            fastForward(wait);
            a.invoke(_wallet, "executeIssue", id, _target, _function, ["address", "uint256"], _first, _second);
        }
    }

    function requireOutsiderIsRefused(address _wallet, address _token) internal {
        require(rejects(outsider, _wallet, "proposeIssueNoArgs", _wallet, "cancelUpgrade"), "Outsider proposed");
        require(
            rejects(outsider, _wallet, "proposeIssue", _token, "transfer", ["address", "uint256"], address(outsider), 1),
            "Outsider proposed a transfer"
        );
        require(rejects(outsider, _wallet, "acceptNomination"), "Outsider accepted a nomination");
        require(rejects(outsider, _wallet, "nominateSigner", address(outsider)), "Outsider nominated directly");
        require(rejects(outsider, _wallet, "removeSigner", address(a), 2), "Outsider removed a signer directly");
        require(rejects(outsider, _wallet, "setRequiredApprovals", 2), "Outsider changed approvals directly");
        require(rejects(outsider, _wallet, "setTransactionTimelock", 0), "Outsider changed the timelock directly");
        require(rejects(outsider, _wallet, "revokeNomination", address(a)), "Outsider revoked a nomination directly");
        require(rejects(outsider, _wallet, "cancelIssue", "x"), "Outsider cancelled an issue directly");
        require(rejects(outsider, _wallet, "scheduleUpgrade", candidate, "2", ""), "Outsider scheduled an upgrade");
        require(rejects(outsider, _wallet, "cancelUpgrade"), "Outsider cancelled an upgrade");
        require(rejects(outsider, _wallet, "freezeUpgrades"), "Outsider froze upgrades");
        require(rejects(outsider, _wallet, "advanceConfiguration"), "Outsider advanced the configuration");
        require(
            rejects(outsider, _wallet, "initialize", [address(outsider), address(a), address(b)], 2, 0),
            "Wallet was initialized twice"
        );
    }

    /// @dev Every governance action a wallet on the candidate must still be able to perform.
    function exercise(address _wallet, PublicationSigner _nominee, PublicationSigner _spare) internal {
        PublicationToken token = new PublicationToken(_wallet);
        require(MultisigLogic(_wallet).multisigHealthCheck(), "Wallet is not healthy on the candidate");
        requireOutsiderIsRefused(_wallet, address(token));

        // Propose, approve, wait, execute.
        passAddressUint(_wallet, address(token), "transfer", address(outsider), 100);
        require(token.balanceOf(address(outsider)) == 100, "Transfer did not execute");

        // Withdrawing an approval ends the waiting period.
        string withdrawn = a.invoke(_wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 1);
        b.invoke(_wallet, "approveIssue", withdrawn, address(token), "transfer", ["address", "uint256"], address(outsider), 1);
        b.invoke(_wallet, "revokeIssueApproval", withdrawn);
        fastForward(TIMELOCK);
        require(
            rejects(a, _wallet, "executeIssue", withdrawn, address(token), "transfer", ["address", "uint256"], address(outsider), 1),
            "Issue executed after an approval was withdrawn"
        );
        a.invoke(_wallet, "revokeIssueApproval", withdrawn);
        a.invoke(_wallet, "dismissIssue", withdrawn);

        // A queued issue is cancelled as soon as the cancellation reaches M.
        string queued = a.invoke(_wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 2);
        b.invoke(_wallet, "approveIssue", queued, address(token), "transfer", ["address", "uint256"], address(outsider), 2);
        string cancellation = a.invoke(_wallet, "proposeIssue", _wallet, "cancelIssue", ["string"], queued);
        b.invoke(_wallet, "approveIssue", cancellation, _wallet, "cancelIssue", ["string"], queued);
        fastForward(TIMELOCK);
        require(
            rejects(a, _wallet, "executeIssue", queued, address(token), "transfer", ["address", "uint256"], address(outsider), 2),
            "Cancelled issue executed"
        );

        // A nomination can be withdrawn immediately, and a new one accepted.
        passAddress(_wallet, "nominateSigner", address(_spare));
        string revocation = a.invoke(_wallet, "proposeIssue", _wallet, "revokeNomination", ["address"], address(_spare));
        b.invoke(_wallet, "approveIssue", revocation, _wallet, "revokeNomination", ["address"], address(_spare));
        require(rejects(_spare, _wallet, "acceptNomination"), "Revoked nominee was added");

        passAddress(_wallet, "nominateSigner", address(_nominee));
        _nominee.invoke(_wallet, "acceptNomination");
        require(MultisigLogic(_wallet).signerMap(address(_nominee)) > 0, "Nominee was not added");
        require(MultisigLogic(_wallet).requiredApprovals() == 2, "Adding a signer changed required approvals");
        require(MultisigLogic(_wallet).multisigHealthCheck(), "Signer set is inconsistent after an addition");

        // Approvals needed, then removal with approvals set in the same step.
        passUint(_wallet, "setRequiredApprovals", 3);
        require(MultisigLogic(_wallet).requiredApprovals() == 3, "Required approvals did not change");
        passAddressUint(_wallet, _wallet, "removeSigner", address(_nominee), 2);
        require(MultisigLogic(_wallet).signerMap(address(_nominee)) == 0, "Signer was not removed");
        require(MultisigLogic(_wallet).requiredApprovals() == 2, "Removal did not set required approvals");
        require(MultisigLogic(_wallet).multisigHealthCheck(), "Signer set is inconsistent after a removal");
        require(rejects(_nominee, _wallet, "proposeIssueNoArgs", _wallet, "cancelUpgrade"), "Removed signer proposed");

        // Waiting period, after which a final approval executes at once.
        passUint(_wallet, "setTransactionTimelock", 0);
        require(MultisigLogic(_wallet).transactionTimelock() == 0, "Timelock did not change");
        passAddressUint(_wallet, address(token), "transfer", address(outsider), 50);
        require(token.balanceOf(address(outsider)) == 150, "Transfer did not execute on the final approval");

        // The shell still takes instructions from the wallet's quorum.
        string freeze = a.invoke(_wallet, "proposeIssueNoArgs", _wallet, "freezeUpgrades");
        b.invoke(_wallet, "approveIssueNoArgs", freeze, _wallet, "freezeUpgrades");
        require(MultisigWallet(_wallet).multisigUpgradesFrozen(), "Quorum could not freeze upgrades");
        requireOutsiderIsRefused(_wallet, address(token));
    }

    function it_runs_every_governance_action_on_a_wallet_created_on_the_candidate() {
        address wallet = deploy(factory, "2");
        require(MultisigWallet(wallet).logicContract() == candidate, "Wallet is not on the candidate");
        requireUpgradeIsRefusedDuringAnIssue(wallet);
        exercise(wallet, d, e);
    }

    function it_runs_every_governance_action_on_a_wallet_upgraded_to_the_candidate() {
        address wallet = deploy(factory, "1");
        PublicationToken token = new PublicationToken(wallet);

        // Give the old version real state to carry over: a fourth signer, an open
        // nomination and an open issue.
        string[] nominationTypes = ["address", "address[]", "uint256"];
        string added = a.invoke(wallet, "proposeIssue", wallet, "nominateConfiguration", nominationTypes, address(d), [address(a), address(b), address(c), address(d)], 2);
        b.invoke(wallet, "approveIssue", added, wallet, "nominateConfiguration", nominationTypes, address(d), [address(a), address(b), address(c), address(d)], 2);
        fastForward(TIMELOCK);
        a.invoke(wallet, "executeIssue", added, wallet, "nominateConfiguration", nominationTypes, address(d), [address(a), address(b), address(c), address(d)], 2);
        d.invoke(wallet, "acceptNomination");

        string pending = a.invoke(wallet, "proposeIssue", wallet, "nominateConfiguration", nominationTypes, address(e), [address(a), address(b), address(c), address(d), address(e)], 2);
        b.invoke(wallet, "approveIssue", pending, wallet, "nominateConfiguration", nominationTypes, address(e), [address(a), address(b), address(c), address(d), address(e)], 2);
        fastForward(TIMELOCK);
        a.invoke(wallet, "executeIssue", pending, wallet, "nominateConfiguration", nominationTypes, address(e), [address(a), address(b), address(c), address(d), address(e)], 2);
        string stale = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(outsider), 7);

        uint indexA = MultisigLogic(wallet).signerMap(address(a));
        uint indexB = MultisigLogic(wallet).signerMap(address(b));
        uint indexC = MultisigLogic(wallet).signerMap(address(c));
        uint indexD = MultisigLogic(wallet).signerMap(address(d));

        upgrade(wallet, candidate, "2");
        outsider.invoke(wallet, "executeUpgrade");

        require(MultisigWallet(wallet).logicContract() == candidate, "Upgrade did not install the candidate");
        require(MultisigWallet(wallet).multisigCurrentVersion() == "2", "Upgrade did not record the version");
        require(MultisigLogic(wallet).signerMap(address(a)) == indexA, "Upgrade changed a signer");
        require(MultisigLogic(wallet).signerMap(address(b)) == indexB, "Upgrade changed a signer");
        require(MultisigLogic(wallet).signerMap(address(c)) == indexC, "Upgrade changed a signer");
        require(MultisigLogic(wallet).signerMap(address(d)) == indexD, "Upgrade changed a signer");
        require(MultisigLogic(wallet).signerMap(address(e)) == 0, "Upgrade activated a pending nominee");
        require(MultisigLogic(wallet).requiredApprovals() == 2, "Upgrade changed required approvals");
        require(MultisigLogic(wallet).transactionTimelock() == TIMELOCK, "Upgrade changed the timelock");
        require(rejects(e, wallet, "acceptNomination"), "Nomination from the old version was accepted");
        require(
            rejects(b, wallet, "approveIssue", stale, address(token), "transfer", ["address", "uint256"], address(outsider), 7),
            "Issue from the old version survived the upgrade"
        );

        requireUpgradeIsRefusedDuringAnIssue(wallet);
        exercise(wallet, f, e);
    }

    /// @dev Wallets created before a registry update keep the shell they were created with.
    function it_runs_every_governance_action_on_a_published_wallet_upgraded_to_the_candidate() {
        address wallet = deploy(publishedFactory, "1");
        upgrade(wallet, candidate, "2");
        outsider.invoke(wallet, "executeUpgrade");
        require(MultisigWallet(wallet).logicContract() == candidate, "Upgrade did not install the candidate");
        require(MultisigWallet(wallet).multisigCurrentVersion() == "2", "Upgrade did not record the version");
        exercise(wallet, d, e);
    }
}
