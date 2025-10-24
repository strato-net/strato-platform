import "../../concrete/Tokens/Token.sol";
import "../../abstract/ERC20/IERC20.sol";

abstract contract BridgeEscrow {
    function _escrowFunds(address token, address from, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(from, address(this), amount), "Escrow: transfer failed");
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        actualAmount = balanceAfter - balanceBefore;
        require(actualAmount > 0, "Escrow: no tokens received");
    }

    function _refundFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        require(IERC20(token).transfer(to, amount), "Escrow: transfer failed");
        uint256 balanceAfter = IERC20(token).balanceOf(to);
        actualAmount = balanceAfter - balanceBefore;
        require(actualAmount > 0, "Escrow: no tokens sent");
    }

    function _burnFunds(address token, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        Token(token).burn(address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        actualAmount = balanceBefore - balanceAfter;
        require(actualAmount > 0, "Escrow: no tokens burned");
    }

    function _mintFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        Token(token).mint(to, amount);
        uint256 balanceAfter = IERC20(token).balanceOf(to);
        actualAmount = balanceAfter - balanceBefore;
        require(actualAmount > 0, "Escrow: no tokens minted");
    }
}
