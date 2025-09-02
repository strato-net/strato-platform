import "../../abstract/ERC20/access/Ownable.sol";
import "./CDPVault.sol";
import "./CDPEngine.sol";
import "../Lending/PriceOracle.sol";

/**
 * @title CDPRegistry
 * @notice Central registry contract storing addresses of core CDP protocol components.
 * @dev Can only be updated by the PoolConfigurator contract via access control or ownership.
 */
 
contract record CDPRegistry is Ownable {
    
    CDPVault public cdpVault;
    CDPEngine public cdpEngine;
    PriceOracle public priceOracle;

    event ComponentsUpdated(
        address indexed cdpVault,
        address indexed cdpEngine,
        address indexed priceOracle
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Set all components in a single transaction (most gas efficient)
     * @param _cdpVault CDPVault address
     * @param _cdpEngine CDPEngine address
     * @param _priceOracle PriceOracle address
     */
    function setAllComponents(
        address _cdpVault,
        address _cdpEngine,
        address _priceOracle
    ) external onlyOwner {
        // Validate addresses individually
        require(_cdpVault != address(0), "Invalid cdpVault address");
        require(_cdpEngine != address(0), "Invalid cdpEngine address");
        require(_priceOracle != address(0), "Invalid priceOracle address");

        cdpVault = CDPVault(_cdpVault);
        cdpEngine = CDPEngine(_cdpEngine);
        priceOracle = PriceOracle(_priceOracle);
        emit ComponentsUpdated(_cdpVault, _cdpEngine, _priceOracle);
    }

    /**
     * @notice Set individual component addresses
     */
    function setCDPVault(address _cdpVault) external onlyOwner {
        require(_cdpVault != address(0), "Invalid address");
        cdpVault = CDPVault(_cdpVault);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle));
    }

    function setCDPEngine(address _cdpEngine) external onlyOwner {
        require(_cdpEngine != address(0), "Invalid address");
        cdpEngine = CDPEngine(_cdpEngine);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle));
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "Invalid address");
        priceOracle = PriceOracle(_priceOracle);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle));
    }


    /**
     * @notice Get all component addresses in a single call
     * @return cdpVault, cdpEngine, priceOracle
     */
    function getAllComponents() external view returns (
        address,
        address,
        address
    ) {
        return (
            address(cdpVault),
            address(cdpEngine),
            address(priceOracle)
        );
    }

} 