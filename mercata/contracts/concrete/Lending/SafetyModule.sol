import "./LendingRegistry.sol";

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title SafetyModule
 * @notice Handles the safety module for the lending pool.
 * @dev Only callable by the LendingPool.
 */

contract record SafetyModule is Ownable {
    LendingRegistry public registry;
    address public sToken;

    constructor(address _registry, address initialOwner, address _sToken) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        require(_sToken != address(0) && tokenFactory.isTokenActive(_sToken), "Invalid or inactive sToken");
        registry = LendingRegistry(_registry);
        sToken = _sToken;
    }

    // Setter function for updating the LendingRegistry reference
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }

    /**
     * @notice Set sToken for the single borrowable asset
     * @param _sToken The sToken for the asset that can be borrowed
     */
    function setSToken(address _sToken) external onlyPoolConfigurator {
        require(_sToken != address(0) && tokenFactory.isTokenActive(_sToken), "Invalid or inactive sToken");
        sToken = _sToken;
    }
}