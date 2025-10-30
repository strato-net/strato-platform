// SPDX-License-Identifier: MIT

/*
 * CDPRegistry
 * - Single source of truth for CDP component addresses
 */

import "../../abstract/ERC20/access/Ownable.sol";
import "./CDPVault.sol";
import "./CDPEngine.sol";
import "../Lending/PriceOracle.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Admin/FeeCollector.sol";
import "./CDPReserve.sol";

contract record CDPRegistry is Ownable {
  CDPVault public cdpVault;
  CDPEngine public cdpEngine;
  PriceOracle public priceOracle;

  // Additional shared components
  Token public usdst;
  TokenFactory public tokenFactory;
  FeeCollector public feeCollector;
  CDPReserve public cdpReserve;

  event ComponentsUpdated(
    address indexed cdpVault,
    address indexed cdpEngine,
    address indexed priceOracle,
    address usdst,
    address tokenFactory,
    address feeCollector,
    address cdpReserve
  );

  constructor(address initialOwner) Ownable(initialOwner) {}

  function setAllComponents(
    address _cdpVault,
    address _cdpEngine,
    address _priceOracle,
    address _usdst,
    address _tokenFactory,
    address _feeCollector,
    address _cdpReserve
  ) external onlyOwner {
    require(_cdpVault != address(0), "Invalid cdpVault");
    require(_cdpEngine != address(0), "Invalid cdpEngine");
    require(_priceOracle != address(0), "Invalid priceOracle");
    require(_usdst != address(0), "Invalid USDST");
    require(_tokenFactory != address(0), "Invalid tokenFactory");
    require(_feeCollector != address(0), "Invalid feeCollector");
    require(_cdpReserve != address(0), "Invalid cdpReserve");

    cdpVault = CDPVault(_cdpVault);
    cdpEngine = CDPEngine(_cdpEngine);
    priceOracle = PriceOracle(_priceOracle);
    usdst = Token(_usdst);
    tokenFactory = TokenFactory(_tokenFactory);
    feeCollector = FeeCollector(_feeCollector);
    cdpReserve = CDPReserve(_cdpReserve);

    emit ComponentsUpdated(
      _cdpVault, _cdpEngine, _priceOracle, _usdst, _tokenFactory, _feeCollector, _cdpReserve
    );
  }

  // Individual setters for flexibility

  function setCDPVault(address _cdpVault) external onlyOwner {
    require(_cdpVault != address(0), "Invalid address");
    cdpVault = CDPVault(_cdpVault);
    emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle),
      address(usdst), address(tokenFactory), address(feeCollector), address(cdpReserve));
  }

  function setCDPEngine(address _cdpEngine) external onlyOwner {
    require(_cdpEngine != address(0), "Invalid address");
    cdpEngine = CDPEngine(_cdpEngine);
    emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle),
      address(usdst), address(tokenFactory), address(feeCollector), address(cdpReserve));
  }

  function setPriceOracle(address _priceOracle) external onlyOwner {
    require(_priceOracle != address(0), "Invalid address");
    priceOracle = PriceOracle(_priceOracle);
    emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle),
      address(usdst), address(tokenFactory), address(feeCollector), address(cdpReserve));
  }

  function setUSDST(address _usdst) external onlyOwner {
    require(_usdst != address(0), "Invalid address");
    usdst = Token(_usdst);
    emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle),
      address(usdst), address(tokenFactory), address(feeCollector), address(cdpReserve));
  }

  function setTokenFactory(address _tokenFactory) external onlyOwner {
    require(_tokenFactory != address(0), "Invalid address");
    tokenFactory = TokenFactory(_tokenFactory);
    emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle),
      address(usdst), address(tokenFactory), address(feeCollector), address(cdpReserve));
  }

  function setFeeCollector(address _feeCollector) external onlyOwner {
    require(_feeCollector != address(0), "Invalid address");
    feeCollector = FeeCollector(_feeCollector);
    emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle),
      address(usdst), address(tokenFactory), address(feeCollector), address(cdpReserve));
  }

  function setCDPReserve(address _cdpReserve) external onlyOwner {
    require(_cdpReserve != address(0), "Invalid address");
    cdpReserve = CDPReserve(_cdpReserve);
    emit ComponentsUpdated(address(cdpVault), address(cdpEngine), address(priceOracle),
      address(usdst), address(tokenFactory), address(feeCollector), address(cdpReserve));
  }

  function getAllComponents() external view returns (
    address, address, address, address, address, address, address
  ) {
    return (
      address(cdpVault),
      address(cdpEngine),
      address(priceOracle),
      address(usdst),
      address(tokenFactory),
      address(feeCollector),
      address(cdpReserve)
    );
  }
}