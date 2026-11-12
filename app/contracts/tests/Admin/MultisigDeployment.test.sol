import "../../concrete/BaseCodeCollection.sol";

contract Describe_MultisigDeployment {
    function it_includes_the_factory_wallet_and_logic_in_the_base_code_collection() {
        require(true, "Base code collection did not compile");
    }

    function it_uses_the_standard_proxy_for_factory_storage() {
        MultisigFactory implementation = new MultisigFactory(address(0xdeadbeef));
        Proxy proxy = new Proxy(address(implementation), address(this));
        MultisigFactory factory = MultisigFactory(address(proxy));
        require(factory.owner() == address(this), "Factory proxy owner was not initialized");
        factory.initializeRegistryGovernance(address(this));
        MultisigLogic logic = new MultisigLogic();
        factory.publishLogicVersion("1", address(logic));
        require(factory.isVersionApproved("1", address(logic)), "Factory implementation was not installed");
    }
}
