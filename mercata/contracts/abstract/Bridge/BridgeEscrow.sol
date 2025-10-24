import "../../concrete/Tokens/Token.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title BridgeEscrow
 * @dev Abstract contract providing escrow functionality for bridge operations
 * @notice Handles token escrow, refund, burn, and mint operations with balance verification
 */
abstract contract BridgeEscrow {
    /**
     * @dev Burns tokens from the escrow contract
     * @param token The token contract address
     * @param amount The amount of tokens to burn
     * @return actualAmount The actual amount of tokens burned
     */
    function _burnFunds(address token, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        Token(token).burn(address(this), amount);
        actualAmount = balanceBefore - IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "Escrow: no tokens burned");
    }

    /**
     * @dev Escrows tokens from a user to this contract
     * @param token The token contract address
     * @param from The address to transfer tokens from
     * @param amount The amount of tokens to escrow
     * @return actualAmount The actual amount of tokens escrowed
     */
    function _escrowFunds(address token, address from, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(from, address(this), amount), "Escrow: transfer failed");
        actualAmount = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(actualAmount > 0, "Escrow: no tokens received");
    }

    /**
     * @dev Mints tokens to a recipient address
     * @param token The token contract address
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     * @return actualAmount The actual amount of tokens minted
     */
    function _mintFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        Token(token).mint(to, amount);
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "Escrow: no tokens minted");
    }

    /**
     * @dev Refunds tokens from this contract to a recipient
     * @param token The token contract address
     * @param to The address to refund tokens to
     * @param amount The amount of tokens to refund
     * @return actualAmount The actual amount of tokens refunded
     */
    function _refundFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transfer(to, amount), "Escrow: transfer failed");
        actualAmount = balanceBefore - IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "Escrow: no tokens sent");
    }
}
