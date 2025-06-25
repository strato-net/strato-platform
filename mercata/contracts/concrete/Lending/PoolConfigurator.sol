import "./LendingRegistry.sol";
import "./LendingPool.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../AdminRegistry/AdminRegistry.sol";

/**
 * @title PoolConfigurator
 * @notice Governance contract responsible for updating addresses in the LendingRegistry
 *         and configuring LendingPool risk parameters like interest rates and collateral ratios.
 * @dev Meant to be controlled by admins through AdminRegistry for secure protocol configuration.
 */

contract record PoolConfigurator is Ownable {
   
    LendingRegistry public registry;
    AdminRegistry public adminRegistry;

    constructor(address _registry, address initialOwner, address _adminRegistry) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry");
        require(_adminRegistry != address(0), "Invalid admin registry");
        registry = LendingRegistry(_registry);
        adminRegistry = AdminRegistry(_adminRegistry);
    }
    
    modifier onlyAdmin() {
        require(adminRegistry.isAdminAddress(msg.sender), "PoolConfigurator: caller is not admin");
        _;
    }
    
    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Invalid admin registry");
        adminRegistry = AdminRegistry(_adminRegistry);
    }

    // Registry Setters
    function setLendingPool(address newAddress) external onlyAdmin {
        require(newAddress != address(0), "Invalid address");
        registry.setLendingPool(newAddress);
    }

    function setLiquidityPool(address newAddress) external onlyAdmin {
        require(newAddress != address(0), "Invalid address");
        registry.setLiquidityPool(newAddress);
    }

    function setCollateralVault(address newAddress) external onlyAdmin {
        require(newAddress != address(0), "Invalid address");
        registry.setCollateralVault(newAddress);
    }

    function setRateStrategy(address newAddress) external onlyAdmin {
        require(newAddress != address(0), "Invalid address");
        registry.setRateStrategy(newAddress);
    }

    function setPriceOracle(address newAddress) external onlyAdmin {
        require(newAddress != address(0), "Invalid address");
        registry.setPriceOracle(newAddress);
    }

    function setTokenFactory(address _tokenFactory) external onlyAdmin {
        registry.setTokenFactory(_tokenFactory);
    }

    // LendingPool Risk Parameters
    function setInterestRate(address asset, uint256 newRate) external onlyAdmin {
        registry.lendingPool().setInterestRate(asset, newRate);
    }

    function setCollateralRatio(address asset, uint256 newRatio) external onlyAdmin {
        registry.lendingPool().setCollateralRatio(asset, newRatio);
    }

    function setLiquidationBonus(address asset, uint256 newBonus) external onlyAdmin {
        registry.lendingPool().setLiquidationBonus(asset, newBonus);
    }
}