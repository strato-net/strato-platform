import "./BaseCodeCollection.sol";

contract record BatchUpgrade_BridgeAutoSave {
    AdminRegistry adminRegistry = AdminRegistry(address(0x100c));
    address blockAppsUser = address(0xe291868dbbffb7d05b1842661c984d80891892a0);

    address liquidityPoolProxy = address(0x1004);
    address lendingPoolProxy = address(0x1005);
    address lendingRegistryProxy = address(0x1007);
    address mercataBridgeProxy = address(0x1008);
    address bridgeRelayerService = address(0x882f3d3a7b97ea24ab5aeae6996a695b26ea9089);

    string contract_source = <CONTRACT_SOURCE>;

    constructor() {}

    function execute() external {
        adminRegistry.castVoteOnIssue(msg.sender, "entrypoint");
    }

    function entrypoint() external {
        address newLiquidityPool = address(blockAppsUser).derive("LiquidityPool12122025.1", "LiquidityPool", address(0xdeadbeef));
        adminRegistry.castVoteOnIssue(address(blockAppsUser), "createSaltedContract",
            "LiquidityPool12122025.1",
            "LiquidityPool",
            contract_source,
            address(0xdeadbeef)
        );
        Proxy(liquidityPoolProxy).setLogicContract(newLiquidityPool);

        address newLendingPool = address(blockAppsUser).derive("LendingPool12122025.1", "LendingPool", address(0xdeadbeef));
        adminRegistry.castVoteOnIssue(address(blockAppsUser), "createSaltedContract",
            "LendingPool12122025.1",
            "LendingPool",
            contract_source,
            address(0xdeadbeef)
        );
        Proxy(lendingPoolProxy).setLogicContract(newLendingPool);

        address newMercataBridge = address(blockAppsUser).derive("MercataBridge12122025.1", "MercataBridge", address(0xdeadbeef));
        adminRegistry.castVoteOnIssue(address(blockAppsUser), "createSaltedContract",
            "MercataBridge12122025.1",
            "MercataBridge",
            contract_source,
            address(0xdeadbeef)
        );
        Proxy(mercataBridgeProxy).setLogicContract(newMercataBridge);

        adminRegistry.addWhitelist(mercataBridgeProxy, "requestAutoSave", bridgeRelayerService);

        MercataBridge(mercataBridgeProxy).setLendingRegistry(lendingRegistryProxy);

        require(false, "test successful; reverting so as not to commit the upgrade");
    }
}