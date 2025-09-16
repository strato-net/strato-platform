import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/ERC20.sol";
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

  function _usdst() internal view returns (Token) { return Token(address(registry.usdst())); }

  event Transferred(address indexed to, uint256 amount);
  event Skimmed(address indexed token, uint256 amount, address indexed to);

  modifier onlyEngine() {
    require(msg.sender == address(registry.cdpEngine()), "Reserve: not engine");
    _;
  }

  constructor(address _registry, address _owner) Ownable(_owner) {
    require(_registry != address(0), "CDPReserve: Invalid registry");
    registry = CDPRegistry(_registry);
  }

  /// @notice Update the registry reference (owner only)
  function setRegistry(address _registry) external onlyOwner {
    require(_registry != address(0), "CDPReserve: Invalid registry");
    registry = CDPRegistry(_registry);
  }

  /// @notice Called by Engine to pay out USDST to `to`.
  function transferTo(address to, uint256 amount) external onlyEngine {
    require(to != address(0), "Reserve: to=0");
    require(ERC20(address(_usdst())).transfer(to, amount), "Reserve: transfer failed");
    emit Transferred(to, amount);
  }

}