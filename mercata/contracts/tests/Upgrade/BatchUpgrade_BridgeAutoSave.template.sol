import './concrete/Admin/AdminRegistry.sol';
import './concrete/Proxy/Proxy.sol';

contract record BatchUpgrade_BridgeAutoSave {
    AdminRegistry adminRegistry = AdminRegistry(address(0x100c));
    address blockAppsUser;

    address liquidityPoolProxy = 0x1004;
    address lendingPoolProxy = 0x1005;
    address mercataBridgeProxy = 0x1008;
    address bridgeRelayerService = 0x882f3d3a7b97ea24ab5aeae6996a695b26ea9089;

    string contract_source = <CONTRACT_SOURCE>;

    constructor(address _blockAppsUser) {
        blockAppsUser = _blockAppsUser;
    }

    function execute() external {
        adminRegistry.castVoteOnIssue(msg.sender, "entrypoint");
    }

    function entrypoint() external {
        address newLiquidityPool = address(blockAppsUser).derive("LiquidityPool12122025.1", "LiquidityPool", address(0xdeadbeef));
        adminRegistry.castVoteOnIssue(address(blockAppsUser), "createSaltedContract", "LiquidityPool12122025.1", "LiquidityPool", contract_source, address(0xdeadbeef));
        Proxy(liquidityPoolProxy).setLogicContract(newLiquidityPool);

        address newLendingPool = address(blockAppsUser).derive("LendingPool12122025.1", "LendingPool", address(0xdeadbeef));
        adminRegistry.castVoteOnIssue(address(blockAppsUser), "createSaltedContract", "LendingPool12122025.1", "LendingPool", contract_source, address(0xdeadbeef));
        Proxy(lendingPoolProxy).setLogicContract(newLendingPool);

        adminRegistry.addWhitelist(mercataBridgeProxy, "requestAutoSave", bridgeRelayerService);

        require(false, "test successful; reverting so as not to commit the upgrade");
    }
}