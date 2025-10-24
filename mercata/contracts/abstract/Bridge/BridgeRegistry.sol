import "../../libraries/Bridge/BridgeTypes.sol";

/**
 * @title BridgeRegistry
 * @dev Abstract contract managing bridge chain and asset configurations
 * @notice Provides registry functionality for external chains and their associated assets
 * @notice Handles chain information, asset mappings, and block processing state
 */
abstract contract BridgeRegistry {
    /// @notice Enables BridgeTypes library functions for all types
    /// @dev Allows direct access to BridgeTypes utility functions without explicit library calls
    using BridgeTypes for *;
    
    /// @notice Registry of external chains and their configuration
    /// @dev Maps external chain ID to chain information including custody, router, and processing state
    /// @dev Key: externalChainId (uint256) -> Value: ChainInfo struct
    mapping(uint256 => ChainInfo) public record chains;
    
    /// @notice Registry of assets for each external chain
    /// @dev Maps external token address and chain ID to asset configuration
    /// @dev Key: (externalToken address, externalChainId) -> Value: AssetInfo struct
    /// @dev Used to configure token mappings between external chains and STRATO
    mapping(address => mapping(uint256 => AssetInfo)) public record assets;

    /// @notice Emitted when chain configuration is updated
    event ChainUpdated(string chainName, address custody, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router);
    
    /// @notice Emitted when the last processed block is updated for a chain
    event LastProcessedBlockUpdated(uint256 externalChainId, uint256 lastProcessedBlock);
    
    /// @notice Emitted during emergency block rollback operations
    event EmergencyBlockRollback(uint256 externalChainId, uint256 lastProcessedBlock);
    
    /// @notice Emitted when asset configuration is updated for a chain
    event AssetUpdated(uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken, bool enabled);

    /**
     * @dev Emergency function to set the last processed block for a chain
     * @notice Allows rollback of block processing state in emergency situations
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The block number to set as last processed
     */
    function _emergencySetLastProcessedBlock(
        uint256 externalChainId, 
        uint256 lastProcessedBlock
    ) internal {
        require(externalChainId > 0, "BR: invalid external chain id");
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "BR: chain missing");
        
        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
        emit EmergencyBlockRollback(externalChainId, lastProcessedBlock);
    }

    /**
     * @dev Sets asset configuration for a specific external chain
     * @notice Maps external tokens to their STRATO equivalents with withdrawal limits
     * @param externalChainId The external chain identifier
     * @param externalDecimals The number of decimals for the external token
     * @param externalName The name of the external token
     * @param externalSymbol The symbol of the external token
     * @param externalToken The address of the external token contract
     * @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
     * @param stratoToken The corresponding STRATO token address
     * @param enabled Whether the asset is enabled for bridge operations
     */
    function _setAsset(
        uint256 externalChainId,
        uint256 externalDecimals,
        string externalName,
        string externalSymbol,
        address externalToken,
        uint256 maxPerWithdrawal,
        address stratoToken,
        bool enabled
    ) internal {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");

        AssetInfo a = assets[externalToken][externalChainId];
        a.stratoToken      = stratoToken;
        a.enabled          = enabled;
        a.externalToken    = externalToken;
        a.externalDecimals = externalDecimals;
        a.externalChainId  = externalChainId;
        a.externalName     = externalName;
        a.externalSymbol   = externalSymbol;
        a.maxPerWithdrawal = maxPerWithdrawal;

        emit AssetUpdated(externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken, enabled);
    }

    /**
     * @dev Sets chain configuration for bridge operations
     * @notice Configures external chain parameters including custody and router addresses
     * @param chainName The human-readable name of the external chain
     * @param custody The custody contract address on the external chain
     * @param enabled Whether the chain is enabled for bridge operations
     * @param externalChainId The unique identifier for the external chain
     * @param lastProcessedBlock The last processed block number for this chain
     * @param router The router contract address for deposits
     */
    function _setChain(
        string chainName,
        address custody,
        bool enabled,
        uint256 externalChainId,
        uint256 lastProcessedBlock,
        address router
    ) internal {
        require(custody != address(0), "BR: zero custody address");
        require(router != address(0), "BR: zero router address");
        require(externalChainId > 0, "BR: invalid external chain id");
        require(chainName.length > 0, "BR: invalid chain name");

        ChainInfo c = chains[externalChainId];
        c.chainName = chainName;
        c.custody = custody;
        c.depositRouter = router;
        c.enabled = enabled;
        c.lastProcessedBlock = lastProcessedBlock;

        emit ChainUpdated(chainName, custody, enabled, externalChainId, lastProcessedBlock, router);
    }

    /**
     * @dev Updates the last processed block for a specific chain
     * @notice Prevents rollback attacks by ensuring block numbers only increase
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The new last processed block number
     */
    function _setLastProcessedBlock(uint256 externalChainId, uint256 lastProcessedBlock) internal {
        require(externalChainId > 0, "BR: invalid external chain id");
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "BR: chain missing");
        
        require(lastProcessedBlock >= chainInfo.lastProcessedBlock, "BR: cannot rollback block");
        
        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
    }
}