import "../../concrete/Admin/MultisigFactory.sol";
import "../../concrete/Admin/MultisigLogic.sol";
import "../../concrete/Proxy/Proxy.sol";

contract UpgradeSigner {
    function invoke(address _target, string _function, variadic _arguments) public returns (variadic) {
        return _target.call(_function, _arguments);
    }
}

contract MultisigLogicV2 is MultisigLogic {
    uint public migrationMarker;

    function migrate() external {
        migrationMarker = 7;
    }

    function migrateFail() external {
        revert("Migration failed");
    }

    function ordinaryFunction() external returns (uint) {
        return 9;
    }
}

contract Describe_MultisigUpgrade {
    MultisigFactory factory;
    MultisigLogic v1;
    MultisigLogicV2 v2;
    UpgradeSigner a;
    UpgradeSigner b;
    UpgradeSigner c;
    UpgradeSigner outsider;

    function beforeEach() {
        v1 = new MultisigLogic();
        v2 = new MultisigLogicV2();
        MultisigFactory implementation = new MultisigFactory(address(0xdeadbeef));
        factory = MultisigFactory(address(new Proxy(address(implementation), address(this))));
        factory.initializeRegistryGovernance(address(this));
        factory.publishLogicVersion("1", address(v1));
        factory.publishLogicVersion("2", address(v2));
        factory.setUpgradePath("1", "2", true);
        a = new UpgradeSigner();
        b = new UpgradeSigner();
        c = new UpgradeSigner();
        outsider = new UpgradeSigner();
    }

    function deploy(uint _timelock) internal returns (address) {
        string setupHash = factory.registerSetup(
            [address(a), address(b), address(c)],
            2,
            _timelock,
            "1",
            "upgrade"
        );
        a.invoke(address(factory), "confirmSetup", setupHash);
        b.invoke(address(factory), "confirmSetup", setupHash);
        return c.invoke(address(factory), "confirmSetup", setupHash);
    }

    function rejects(UpgradeSigner _caller, address _target, string _function, variadic _arguments) internal returns (bool) {
        try _caller.invoke(_target, _function, _arguments) {
            return false;
        } catch {
            return true;
        }
    }

    function schedule(address _wallet, string _migrationFunction) internal returns (string) {
        string[] argumentTypes = ["address", "string", "string"];
        string issueId = a.invoke(
            _wallet,
            "proposeIssue",
            _wallet,
            "scheduleUpgrade",
            argumentTypes,
            address(v2),
            "2",
            _migrationFunction
        );
        b.invoke(
            _wallet,
            "approveIssue",
            issueId,
            _wallet,
            "scheduleUpgrade",
            argumentTypes,
            address(v2),
            "2",
            _migrationFunction
        );
        return issueId;
    }

    function it_executes_an_approved_upgrade_and_committed_migration() {
        address wallet = deploy(0);
        schedule(wallet, "migrate");
        require(
            rejects(outsider, wallet, "executeUpgrade"),
            "Upgrade executed before fixed delay"
        );
        fastForward(604800);
        outsider.invoke(wallet, "executeUpgrade");
        require(MultisigWallet(wallet).logicContract() == address(v2), "Logic did not upgrade");
        require(MultisigWallet(wallet).multisigCurrentVersion() == "2", "Version did not upgrade");
        require(MultisigLogicV2(wallet).migrationMarker() == 7, "Migration did not run");
        require(rejects(outsider, wallet, "migrate"), "Migration function remained externally callable");
        require(MultisigLogicV2(wallet).ordinaryFunction() == 9, "Ordinary fallback call was blocked");
        require(MultisigWallet(wallet).multisigEpoch() == 2, "Upgrade did not increment epoch");
    }

    function it_accepts_no_executor_supplied_migration_payload() {
        address wallet = deploy(0);
        schedule(wallet, "migrate");
        fastForward(604800);
        require(
            rejects(outsider, wallet, "executeUpgrade", "migrate", 8),
            "Executor supplied a migration payload"
        );
        outsider.invoke(wallet, "executeUpgrade");
        require(MultisigLogicV2(wallet).migrationMarker() == 7, "Committed no-argument migration did not run");
    }

    function it_rejects_signature_style_migration_names() {
        address wallet = deploy(0);
        schedule(wallet, "migrate");
        fastForward(604800);
        outsider.invoke(wallet, "executeUpgrade");
        require(
            rejects(outsider, wallet, " migrate()"),
            "Signature-style migration bypassed the fallback guard"
        );
        require(MultisigLogicV2(wallet).ordinaryFunction() == 9, "Ordinary fallback call was blocked");
    }

    function it_rechecks_revocation_at_execution() {
        address wallet = deploy(0);
        schedule(wallet, "");
        factory.revokeLogicVersion("2");
        fastForward(604800);
        require(rejects(outsider, wallet, "executeUpgrade"), "Revoked target executed");
    }

    function it_cancels_with_quorum_without_the_transaction_timelock() {
        address wallet = deploy(100);
        string scheduleIssue = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "scheduleUpgrade",
            ["address", "string", "string"],
            address(v2),
            "2",
            ""
        );
        b.invoke(
            wallet,
            "approveIssue",
            scheduleIssue,
            wallet,
            "scheduleUpgrade",
            ["address", "string", "string"],
            address(v2),
            "2",
            ""
        );
        fastForward(100);
        c.invoke(
            wallet,
            "executeIssue",
            scheduleIssue,
            wallet,
            "scheduleUpgrade",
            ["address", "string", "string"],
            address(v2),
            "2",
            ""
        );

        string cancelIssue = a.invoke(wallet, "proposeIssueNoArgs", wallet, "cancelUpgrade");
        b.invoke(wallet, "approveIssueNoArgs", cancelIssue, wallet, "cancelUpgrade");
        (,,,,,,, bool exists) = MultisigWallet(wallet).multisigPendingUpgrade();
        require(!exists, "Pending upgrade was not cancelled immediately");
    }

    function it_reverts_every_upgrade_write_when_migration_fails() {
        address wallet = deploy(0);
        schedule(wallet, "migrateFail");
        fastForward(604800);
        require(rejects(outsider, wallet, "executeUpgrade"), "Failing migration succeeded");
        require(MultisigWallet(wallet).logicContract() == address(v1), "Failed migration changed logic");
        require(MultisigWallet(wallet).multisigEpoch() == 1, "Failed migration changed epoch");
        (,,,,,,, bool exists) = MultisigWallet(wallet).multisigPendingUpgrade();
        require(exists, "Failed migration cleared pending upgrade");
    }

    function it_rejects_a_non_migration_function_name() {
        address wallet = deploy(0);
        string issueId = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "scheduleUpgrade",
            ["address", "string", "string"],
            address(v2),
            "2",
            "ordinaryFunction"
        );
        require(
            rejects(
                b,
                wallet,
                "approveIssue",
                issueId,
                wallet,
                "scheduleUpgrade",
                ["address", "string", "string"],
                address(v2),
                "2",
                "ordinaryFunction"
            ),
            "Non-migration function was scheduled"
        );
    }

    function it_rejects_a_signature_style_migration_name() {
        address wallet = deploy(0);
        string issueId = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "scheduleUpgrade",
            ["address", "string", "string"],
            address(v2),
            "2",
            "migrate()"
        );
        require(
            rejects(
                b,
                wallet,
                "approveIssue",
                issueId,
                wallet,
                "scheduleUpgrade",
                ["address", "string", "string"],
                address(v2),
                "2",
                "migrate()"
            ),
            "Signature-style migration function was scheduled"
        );
    }

    function it_freezes_upgrades_irreversibly_and_clears_pending_state() {
        address wallet = deploy(0);
        schedule(wallet, "");
        string freezeIssue = a.invoke(wallet, "proposeIssueNoArgs", wallet, "freezeUpgrades");
        b.invoke(wallet, "approveIssueNoArgs", freezeIssue, wallet, "freezeUpgrades");
        require(MultisigWallet(wallet).multisigUpgradesFrozen(), "Upgrades were not frozen");
        (,,,,,,, bool exists) = MultisigWallet(wallet).multisigPendingUpgrade();
        require(!exists, "Freeze did not clear pending upgrade");
        require(rejects(a, wallet, "freezeUpgrades"), "Freeze was reversible or repeatable");
    }

    function it_executes_an_upgrade_without_a_migration_payload() {
        address wallet = deploy(0);
        schedule(wallet, "");
        fastForward(604800);
        outsider.invoke(wallet, "executeUpgrade");
        require(MultisigWallet(wallet).logicContract() == address(v2), "No-migration upgrade failed");
    }

    function it_rechecks_the_upgrade_edge_at_execution() {
        address wallet = deploy(0);
        schedule(wallet, "");
        factory.setUpgradePath("1", "2", false);
        fastForward(604800);
        require(rejects(outsider, wallet, "executeUpgrade"), "Removed upgrade edge executed");
    }

    function it_rejects_expired_upgrades() {
        address wallet = deploy(0);
        schedule(wallet, "");
        fastForward(1209601);
        require(rejects(outsider, wallet, "executeUpgrade"), "Expired upgrade executed");
        schedule(wallet, "");
        (,,,,, uint executableAt,, bool exists) = MultisigWallet(wallet).multisigPendingUpgrade();
        require(exists && executableAt > block.timestamp, "Expired upgrade blocked replacement");
    }

    function it_clears_pending_upgrade_on_configuration_change() {
        address wallet = deploy(0);
        schedule(wallet, "");
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
        (,,,,,,, bool exists) = MultisigWallet(wallet).multisigPendingUpgrade();
        require(!exists, "Configuration change preserved pending upgrade");
    }
}
