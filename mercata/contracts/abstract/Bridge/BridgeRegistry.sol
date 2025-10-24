import "../../libraries/Bridge/BridgeTypes.sol";

abstract contract BridgeRegistry {
    using BridgeTypes for *;
    // key = externalChainId
    mapping(uint256 => ChainInfo) public record chains;
    // key = (externalToken, externalChainId)
    mapping(address => mapping(uint256 => AssetInfo)) public record assets;

    event ChainUpdated(string chainName, address custody, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router);
    event LastProcessedBlockUpdated(uint256 externalChainId, uint256 lastProcessedBlock);
    event EmergencyBlockRollback(uint256 externalChainId, uint256 lastProcessedBlock);
    event AssetUpdated(uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken);

    function _setChain(
        string chainName,
        address custody,
        bool enabled,
        uint256 externalChainId,
        uint256 lastProcessedBlock,
        address router
    ) internal {
        ChainInfo c = chains[externalChainId];
        c.custody = custody;
        c.depositRouter = router;
        c.lastProcessedBlock = lastProcessedBlock;
        c.enabled = enabled;
        c.chainName = chainName;

        emit ChainUpdated(chainName, custody, enabled, externalChainId, lastProcessedBlock, router);
    }

    function _setLastProcessedBlock(uint256 externalChainId, uint256 lastProcessedBlock) internal {
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "MB: chain missing");
        
        uint256 currentBlock = chainInfo.lastProcessedBlock;
        require(lastProcessedBlock >= currentBlock, "MB: cannot rollback block");
        
        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
    }

    function _emergencySetLastProcessedBlock(
        uint256 externalChainId, 
        uint256 lastProcessedBlock
    ) internal {
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "MB: chain missing");
        
        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
        emit EmergencyBlockRollback(externalChainId, lastProcessedBlock);
    }

    function _setAsset(
        uint256 externalChainId,
        uint256 externalDecimals,
        string memory externalName,
        string memory externalSymbol,
        address externalToken,
        uint256 maxPerWithdrawal,
        address stratoToken
    ) internal {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");

        AssetInfo storage a = assets[externalToken][externalChainId];
        a.stratoToken      = stratoToken;
        a.externalToken    = externalToken;
        a.externalDecimals = externalDecimals;
        a.externalChainId  = externalChainId;
        a.externalName     = externalName;
        a.externalSymbol   = externalSymbol;
        a.maxPerWithdrawal = maxPerWithdrawal;

        emit AssetUpdated(externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken);
    }
}