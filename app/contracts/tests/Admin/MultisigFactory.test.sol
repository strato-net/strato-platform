import "../../concrete/Admin/MultisigFactory.sol";
import "../../concrete/Admin/MultisigLogic.sol";
import "../../concrete/Proxy/Proxy.sol";

contract FactorySigner {
    function invoke(address _target, string _function, variadic _arguments) public returns (variadic) {
        return _target.call(_function, _arguments);
    }
}

contract MultisigFactoryV2 is MultisigFactory {
    constructor() MultisigFactory(address(0xdeadbeef)) {}

    function implementationVersion() external returns (uint) {
        return 2;
    }
}

contract TestableMultisigFactory is MultisigFactory {
    constructor() MultisigFactory(address(0xdeadbeef)) {}

    function setupLabel(string _setupHash) external returns (string) {
        return pendingSetups[_setupHash].label;
    }
}

contract Describe_MultisigFactory {
    MultisigFactory factory;
    MultisigLogic logic;
    FactorySigner a;
    FactorySigner b;
    FactorySigner c;
    FactorySigner outsider;

    function deployFactory() internal returns (MultisigFactory) {
        TestableMultisigFactory implementation = new TestableMultisigFactory();
        MultisigFactory deployed = MultisigFactory(address(new Proxy(address(implementation), address(this))));
        deployed.initializeRegistryGovernance(address(this));
        return deployed;
    }

    function beforeEach() {
        logic = new MultisigLogic();
        factory = deployFactory();
        factory.publishLogicVersion("1", address(logic));
        a = new FactorySigner();
        b = new FactorySigner();
        c = new FactorySigner();
        outsider = new FactorySigner();
    }

    function rejects(FactorySigner _caller, address _target, string _function, variadic _arguments) internal returns (bool) {
        try _caller.invoke(_target, _function, _arguments) {
            return false;
        } catch {
            return true;
        }
    }

    function register() internal returns (string, address) {
        return factory.registerSetup(
            [address(c), address(a), address(b)],
            2,
            0,
            "1",
            "treasury"
        );
    }

    function it_requires_every_signer_before_deployment() {
        (string setupHash, address expectedWallet) = register();
        require(expectedWallet != address(0), "Expected wallet was not derived");
        address first = a.invoke(address(factory), "confirmSetup", setupHash);
        address second = b.invoke(address(factory), "confirmSetup", setupHash);
        require(first == address(0), "First signer deployed wallet");
        require(second == address(0), "Second signer deployed wallet");
        require(!factory.factoryWallets(expectedWallet), "Wallet registered before every confirmation");
        address deployed = c.invoke(address(factory), "confirmSetup", setupHash);
        require(deployed == expectedWallet, "Unexpected deployed address");
        require(factory.factoryWallets(expectedWallet), "Wallet was not registered");
        require(MultisigLogic(expectedWallet).requiredApprovals() == 2, "Threshold was not initialized");
        require(MultisigLogic(expectedWallet).signerMap(address(a)) > 0, "Signer was not initialized");
    }

    function it_rejects_duplicate_zero_and_unsafe_thresholds() {
        require(
            rejects(
                outsider,
                address(factory),
                "registerSetup",
                [address(a), address(a), address(c)],
                2,
                0,
                "1",
                "duplicate"
            ),
            "Duplicate signer accepted"
        );
        require(
            rejects(
                outsider,
                address(factory),
                "registerSetup",
                [address(a), address(b), address(0)],
                2,
                0,
                "1",
                "zero"
            ),
            "Zero signer accepted"
        );
        require(
            rejects(
                outsider,
                address(factory),
                "registerSetup",
                [address(a), address(b), address(c)],
                1,
                0,
                "1",
                "one"
            ),
            "One-of-N accepted"
        );
        require(
            rejects(
                outsider,
                address(factory),
                "registerSetup",
                [address(a), address(b), address(c)],
                3,
                0,
                "1",
                "all"
            ),
            "M equal to N accepted"
        );
        require(
            rejects(
                outsider,
                address(factory),
                "registerSetup",
                [address(a), address(b), address(c)],
                2,
                0,
                "1",
                "12345678901234567890123456789012345678901234567890123456789012345"
            ),
            "Oversized label accepted"
        );
    }

    function it_assigns_unique_setup_hashes_and_preserves_the_label() {
        (string first,) = factory.registerSetup(
            [address(a), address(b), address(c)],
            2,
            0,
            "1",
            "canonical"
        );
        (string second,) = factory.registerSetup(
            [address(c), address(a), address(b)],
            2,
            0,
            "1",
            "canonical"
        );
        require(first != second, "Factory nonce did not produce a unique setup hash");
        require(TestableMultisigFactory(address(factory)).setupLabel(first) == "canonical", "Setup label was not preserved");
    }

    function it_allows_only_creator_or_signer_to_cancel() {
        (string setupHash,) = register();
        require(rejects(outsider, address(factory), "cancelSetup", setupHash), "Outsider cancelled setup");
        a.invoke(address(factory), "cancelSetup", setupHash);
        require(rejects(b, address(factory), "confirmSetup", setupHash), "Cancelled setup accepted confirmation");
    }

    function it_refuses_deployment_after_initial_version_revocation() {
        (string setupHash,) = register();
        a.invoke(address(factory), "confirmSetup", setupHash);
        b.invoke(address(factory), "confirmSetup", setupHash);
        factory.revokeLogicVersion("1");
        require(rejects(c, address(factory), "confirmSetup", setupHash), "Revoked version deployed");
    }

    function it_rejects_expired_setups() {
        (string setupHash,) = register();
        fastForward(2592001);
        require(rejects(a, address(factory), "confirmSetup", setupHash), "Expired setup accepted confirmation");
    }

    function it_limits_registry_changes_to_governance() {
        MultisigLogic other = new MultisigLogic();
        require(
            rejects(outsider, address(factory), "publishLogicVersion", "2", address(other)),
            "Outsider published a version"
        );
        require(
            rejects(outsider, address(factory), "setRegistryGovernance", address(outsider)),
            "Outsider replaced registry governance"
        );
        factory.setRegistryGovernance(address(a));
        require(
            rejects(outsider, address(factory), "initializeRegistryGovernance", address(outsider)),
            "Registry governance was reinitialized"
        );
        a.invoke(address(factory), "publishLogicVersion", "2", address(other));
        require(factory.isVersionApproved("2", address(other)), "Replacement governance could not publish");
    }

    function it_upgrades_the_factory_implementation_without_losing_registry_state() {
        (string setupHash, address expectedWallet) = register();
        MultisigFactoryV2 next = new MultisigFactoryV2();
        require(
            rejects(outsider, address(factory), "setLogicContract", address(next)),
            "Outsider upgraded factory proxy"
        );
        Proxy(address(factory)).setLogicContract(address(next));
        require(MultisigFactoryV2(address(factory)).implementationVersion() == 2, "Factory implementation did not upgrade");
        a.invoke(address(factory), "confirmSetup", setupHash);
        b.invoke(address(factory), "confirmSetup", setupHash);
        address deployed = c.invoke(address(factory), "confirmSetup", setupHash);
        require(deployed == expectedWallet, "Factory state was lost during upgrade");
        require(factory.factoryWallets(expectedWallet), "Upgraded factory did not register wallet");
    }

    function it_freezes_factory_upgrades_without_freezing_the_version_registry() {
        Proxy(address(factory)).renounceOwnership();
        MultisigFactoryV2 next = new MultisigFactoryV2();
        require(rejects(outsider, address(factory), "setLogicContract", address(next)), "Frozen factory upgraded");
        MultisigLogic other = new MultisigLogic();
        factory.publishLogicVersion("2", address(other));
        require(factory.isVersionApproved("2", address(other)), "Frozen proxy disabled registry governance");
    }

    function it_has_no_legacy_or_creator_authority_surface() {
        (string setupHash, address wallet) = register();
        a.invoke(address(factory), "confirmSetup", setupHash);
        b.invoke(address(factory), "confirmSetup", setupHash);
        c.invoke(address(factory), "confirmSetup", setupHash);

        require(rejects(outsider, wallet, "addUserAddress", address(outsider)), "Hidden User authority exists");
        require(rejects(outsider, wallet, "_addAdmin", address(outsider)), "Hidden admin authority exists");
        require(rejects(outsider, wallet, "setLogicContract", address(outsider)), "Legacy upgrade path exists");
        require(rejects(outsider, wallet, "transferOwnership", address(outsider)), "Creator ownership path exists");
        require(
            rejects(outsider, wallet, "initialize", [address(outsider), address(a), address(b)], 2, 0),
            "Wallet was reinitialized"
        );
    }
}
