// SPDX-License-Identifier: MIT

import "../abstract/ERC20/access/Ownable.sol";
import "../abstract/ERC20/ERC20.sol";
import "./CDPRegistry.sol";
import "../Tokens/Token.sol";

/**
 * @title CDPReserve
 * @notice Passive treasury that holds USDST fees. Only the authorized Engine
 *         can move funds out, and only to specified recipients, preserving
 *         single-entry accounting for fee flows.
 */
contract record CDPReserve is Ownable {
  CDPRegistry public registry;
  address public engine;

  function _usdst() internal view returns (Token) { return Token(address(registry.usdst())); }

  event EngineSet(address indexed oldEngine, address indexed newEngine);
  event Transferred(address indexed to, uint256 amount);
  event Skimmed(address indexed token, uint256 amount, address indexed to);

  modifier onlyEngine() {
    require(msg.sender == engine, "Reserve: not engine");
    _;
  }

  constructor(address _owner) Ownable(_owner) {
    // require(_usdst != address(0), "Reserve: usdst=0");
    // usdst = Token(_usdst);
  }

  function setEngine(address _engine) external onlyOwner {
    require(_engine != address(0), "Reserve: engine=0");
    address old = engine;
    engine = _engine;
    emit EngineSet(old, _engine);
  }

  /// @notice Called by Engine to pay out USDST to `to`.
  function transferTo(address to, uint256 amount) external onlyEngine {
    require(to != address(0), "Reserve: to=0");
    require(ERC20(address(_usdst())).transfer(to, amount), "Reserve: transfer failed");
    emit Transferred(to, amount);
  }

}