import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/Pausable.sol";
import "../Tokens/Token.sol";

/// @title RewardsConverter
/// @notice Converts the rewards token into STRATO at a rate set by the owner.
/// @dev Converted rewards tokens are burned. STRATO is paid from the reserve, which is
///      simply this contract's STRATO balance.
contract record RewardsConverter is Ownable, Pausable {
    address public rewardsToken;
    address public stratoToken;
    /// @notice WAD-scaled STRATO paid per rewards token, in raw units (1e18 = 1:1)
    uint256 public rate;

    event Converted(address indexed user, uint256 rewardsAmount, uint256 stratoAmount, uint256 rate);
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event ReserveWithdrawn(address indexed to, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @dev Callable once. Leaves the contract paused; the token addresses can never change afterwards.
    function initialize(address _rewardsToken, address _stratoToken, uint256 _rate) external onlyOwner {
        require(rewardsToken == address(0), "RewardsConverter: already initialized");
        require(_rewardsToken != address(0), "RewardsConverter: invalid rewards token address");
        require(_stratoToken != address(0), "RewardsConverter: invalid strato token address");
        require(_rate > 0, "RewardsConverter: zero rate");

        rewardsToken = _rewardsToken;
        stratoToken = _stratoToken;
        rate = _rate;
        _pause();
    }

    /// @notice Burn `amount` of the caller's rewards tokens and pay the caller STRATO at the current rate.
    /// @dev The caller approves this contract for `amount` first. Fails as a whole if the reserve is short.
    function convert(uint256 amount) external whenNotPaused {
        require(amount > 0, "RewardsConverter: zero amount");
        uint256 stratoAmount = amount * rate / 1e18;
        require(stratoAmount > 0, "RewardsConverter: zero payout");
        require(IERC20(stratoToken).balanceOf(address(this)) >= stratoAmount, "RewardsConverter: insufficient reserve");

        IERC20(rewardsToken).transferFrom(msg.sender, address(this), amount);
        Token(rewardsToken).burn(amount);
        IERC20(stratoToken).transfer(msg.sender, stratoAmount);

        emit Converted(msg.sender, amount, stratoAmount, rate);
    }

    /// @notice Rewards-token amount the current reserve covers at the current rate.
    function maxConvertible() external view returns (uint256) {
        if (rate == 0) return 0;
        return IERC20(stratoToken).balanceOf(address(this)) * 1e18 / rate;
    }

    function setRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "RewardsConverter: zero rate");
        uint256 oldRate = rate;
        rate = newRate;
        emit RateUpdated(oldRate, newRate);
    }

    function withdrawReserve(address to, uint256 amount) external onlyOwner {
        IERC20(stratoToken).transfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
