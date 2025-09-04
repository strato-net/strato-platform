/*
 * CDPRegistry
 * - Single source of truth for CDP component addresses (Vault, Engine, Oracle, USDST, TokenFactory, FeeCollector)
 * - Owner-only setters with consolidated ComponentsUpdated event
 */

import "../../abstract/ERC20/access/Ownable.sol";
import "./CDPVault.sol";
import "./CDPEngine.sol";
import "../Lending/PriceOracle.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Admin/FeeCollector.sol";

/**
 * @title CDPRegistry
 * @notice Central registry storing addresses of core CDP protocol components.
 */
 
contract record CDPRegistry is Ownable {
    
    CDPVault public cdpVault;
    CDPEngine public cdpEngine;
    PriceOracle public priceOracle;

    // Additional shared components
    Token public usdst;
    TokenFactory public tokenFactory;
    FeeCollector public feeCollector;

    event ComponentsUpdated(
        address indexed cdpVault,
        address indexed cdpEngine,
        address indexed priceOracle,
        address usdst,
        address tokenFactory,
        address feeCollector
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Set all components (vault, engine, oracle, USDST, TokenFactory, FeeCollector)
     */
    function setAllComponents(
        address _cdpVault,
        address _cdpEngine,
        address _priceOracle,
        address _usdst,
        address _tokenFactory,
        address _feeCollector
    ) external onlyOwner {
        require(_cdpVault != address(0), "Invalid cdpVault address");
        require(_cdpEngine != address(0), "Invalid cdpEngine address");
        require(_priceOracle != address(0), "Invalid priceOracle address");
        require(_usdst != address(0), "Invalid USDST address");
        require(_tokenFactory != address(0), "Invalid tokenFactory address");
        require(_feeCollector != address(0), "Invalid feeCollector address");

        cdpVault = CDPVault(_cdpVault);
        cdpEngine = CDPEngine(_cdpEngine);
        priceOracle = PriceOracle(_priceOracle);
        usdst = Token(_usdst);
        tokenFactory = TokenFactory(_tokenFactory);
        feeCollector = FeeCollector(_feeCollector);
        emit ComponentsUpdated(_cdpVault, _cdpEngine, _priceOracle, _usdst, _tokenFactory, _feeCollector);
    }

    /** Owner-only individual setters below */
    function setCDPVault(address _cdpVault) external onlyOwner {
        require(_cdpVault != address(0), "Invalid address");
        cdpVault = CDPVault(_cdpVault);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle), address(usdst), address(tokenFactory), address(feeCollector));
    }

    function setCDPEngine(address _cdpEngine) external onlyOwner {
        require(_cdpEngine != address(0), "Invalid address");
        cdpEngine = CDPEngine(_cdpEngine);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle), address(usdst), address(tokenFactory), address(feeCollector));
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "Invalid address");
        priceOracle = PriceOracle(_priceOracle);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle), address(usdst), address(tokenFactory), address(feeCollector));
    }

    function setUSDST(address _usdst) external onlyOwner {
        require(_usdst != address(0), "Invalid address");
        usdst = Token(_usdst);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle), address(usdst), address(tokenFactory), address(feeCollector));
    }

    function setTokenFactory(address _tokenFactory) external onlyOwner {
        require(_tokenFactory != address(0), "Invalid address");
        tokenFactory = TokenFactory(_tokenFactory);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle), address(usdst), address(tokenFactory), address(feeCollector));
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid address");
        feeCollector = FeeCollector(_feeCollector);
        emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle), address(usdst), address(tokenFactory), address(feeCollector));
    }

    /** Complete getter for all components */
    function getAllComponents() external view returns (
        address,
        address,
        address,
        address,
        address,
        address
    ) {
        return (
            address(cdpVault),
            address(cdpEngine),
            address(priceOracle),
            address(usdst),
            address(tokenFactory),
            address(feeCollector)
        );
    }
} 