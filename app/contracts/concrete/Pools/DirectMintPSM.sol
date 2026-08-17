import "../../abstract/ERC20/access/Ownable.sol";
import "../Admin/FeeCollector.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";

contract DirectMintPSM is Ownable {

    struct MintConfig {
        bool isEnabled;
        uint maxBalance;
        uint feeBps;
    }

    struct BurnConfig {
        bool isEnabled;
        uint minReserve;
        uint feeBps;
    }

    address public mintableToken;
    FeeCollector public feeCollector;
    bool public mintPaused;
    bool public burnPaused;
    mapping(address => MintConfig) public record mintConfigs;
    mapping(address => BurnConfig) public record burnConfigs;

    event MintConfigSet(address token, bool isEnabled, uint maxBalance, uint feeBps);
    event BurnConfigSet(address token, bool isEnabled, uint minReserve, uint feeBps);
    event Redeemed(address user, uint burnAmount, uint payoutAmount, address redeemToken);
    event DirectPSMMinted(address user, uint depositAmount, uint mintAmount, address againstToken);
    event FeeCollectorSet(address feeCollector);
    event MintPauseSet(bool isPaused);
    event BurnPauseSet(bool isPaused);

    bool private reentrancyLock;
    modifier nonReentrant() {
        require(!reentrancyLock, "REENTRANT");
        reentrancyLock = true;
        _;
        reentrancyLock = false;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _mintableToken, address _feeCollector, address[] _eligibleTokens) external onlyOwner {
        require(_mintableToken != address(0), "Invalid mintable token");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_eligibleTokens.length > 0, "Invalid eligible tokens");
        mintableToken = _mintableToken;
        feeCollector = FeeCollector(_feeCollector);
        emit FeeCollectorSet(_feeCollector);
        for (uint i = 0; i < _eligibleTokens.length; i++) {
            setMintConfig(_eligibleTokens[i], true, 0, 0);
            setBurnConfig(_eligibleTokens[i], true, 0, 0);
        }
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid fee collector");
        feeCollector = FeeCollector(_feeCollector);
        emit FeeCollectorSet(_feeCollector);
    }

    function pauseMint() external onlyOwner {
        mintPaused = true;
        emit MintPauseSet(true);
    }

    function unpauseMint() external onlyOwner {
        mintPaused = false;
        emit MintPauseSet(false);
    }

    function pauseBurn() external onlyOwner {
        burnPaused = true;
        emit BurnPauseSet(true);
    }

    function unpauseBurn() external onlyOwner {
        burnPaused = false;
        emit BurnPauseSet(false);
    }

    function _requireValidConfigToken(address token) internal view {
        require(token != address(0) && token != mintableToken, "Invalid token");
        require(Token(token).decimals() == Token(mintableToken).decimals(), "Decimal mismatch"); // unsupported
        _requireActiveToken(token);
    }

    function _tokenFactory() internal view returns (TokenFactory) {
        return TokenFactory(address(Token(mintableToken).tokenFactory()));
    }

    function _requireActiveToken(address token) internal view {
        require(_tokenFactory().isTokenActive(token), "Token not active");
    }

    function setMintConfig(
        address token,
        bool _isEnabled,
        uint _maxBalance,
        uint _feeBps
    ) public onlyOwner {
        _requireValidConfigToken(token);
        require(_feeBps <= 10000, "Invalid fee bps");

        mintConfigs[token] = MintConfig(
            _isEnabled,
            _maxBalance,
            _feeBps
        );

        emit MintConfigSet(token, _isEnabled, _maxBalance, _feeBps);
    }

    function setMintEnabled(address token, bool _isEnabled) external onlyOwner {
        _requireValidConfigToken(token);
        mintConfigs[token].isEnabled = _isEnabled;
        emit MintConfigSet(token, _isEnabled, mintConfigs[token].maxBalance, mintConfigs[token].feeBps);
    }

    function setMintMaxBalance(address token, uint _maxBalance) external onlyOwner {
        _requireValidConfigToken(token);
        mintConfigs[token].maxBalance = _maxBalance;
        emit MintConfigSet(token, mintConfigs[token].isEnabled, _maxBalance, mintConfigs[token].feeBps);
    }

    function setMintFeeBps(address token, uint _feeBps) external onlyOwner {
        _requireValidConfigToken(token);
        require(_feeBps <= 10000, "Invalid fee bps");
        mintConfigs[token].feeBps = _feeBps;
        emit MintConfigSet(token, mintConfigs[token].isEnabled, mintConfigs[token].maxBalance, _feeBps);
    }

    function setBurnConfig(
        address token,
        bool _isEnabled,
        uint _minReserve,
        uint _feeBps
    ) public onlyOwner {
        _requireValidConfigToken(token);
        require(_feeBps <= 10000, "Invalid fee bps");

        burnConfigs[token] = BurnConfig(
            _isEnabled,
            _minReserve,
            _feeBps
        );

        emit BurnConfigSet(token, _isEnabled, _minReserve, _feeBps);
    }

    function setBurnEnabled(address token, bool _isEnabled) external onlyOwner {
        _requireValidConfigToken(token);
        burnConfigs[token].isEnabled = _isEnabled;
        emit BurnConfigSet(token, _isEnabled, burnConfigs[token].minReserve, burnConfigs[token].feeBps);
    }

    function setBurnMinReserve(address token, uint _minReserve) external onlyOwner {
        _requireValidConfigToken(token);
        burnConfigs[token].minReserve = _minReserve;
        emit BurnConfigSet(token, burnConfigs[token].isEnabled, _minReserve, burnConfigs[token].feeBps);
    }

    function setBurnFeeBps(address token, uint _feeBps) external onlyOwner {
        _requireValidConfigToken(token);
        require(_feeBps <= 10000, "Invalid fee bps");
        burnConfigs[token].feeBps = _feeBps;
        emit BurnConfigSet(token, burnConfigs[token].isEnabled, burnConfigs[token].minReserve, _feeBps);
    }

    /// @dev With no escrow, redeemable liquidity is simply the balance above minReserve.
    function availableRedemptionLiquidity(address token) public view returns (uint) {
        uint balance = IERC20(token).balanceOf(address(this));
        uint minReserve = burnConfigs[token].minReserve;
        if (balance <= minReserve) return 0;
        return balance - minReserve;
    }

    function _transfer(address token, address to, uint amount) internal {
        uint balancePSMBefore = IERC20(token).balanceOf(address(this));
        uint balanceRecipientBefore = IERC20(token).balanceOf(to);

        // Perform the transfer
        require(IERC20(token).transfer(to, amount), "Transfer failed");

        uint balancePSMAfter = IERC20(token).balanceOf(address(this));
        uint balanceUserAfter = IERC20(token).balanceOf(to);

        require(balancePSMAfter == balancePSMBefore - amount &&
                balanceUserAfter == balanceRecipientBefore + amount,
                "Balance mismatch");
    }

    function _transferFrom(address token, address from, address to, uint amount) internal {
        uint balanceSenderBefore = IERC20(token).balanceOf(from);
        uint balanceRecipientBefore = IERC20(token).balanceOf(to);

        // Perform the transfer
        require(IERC20(token).transferFrom(from, to, amount), "Transfer failed");

        uint balanceSenderAfter = IERC20(token).balanceOf(from);
        uint balanceRecipientAfter = IERC20(token).balanceOf(to);

        require(balanceSenderAfter == balanceSenderBefore - amount &&
                balanceRecipientAfter == balanceRecipientBefore + amount,
                "Balance mismatch");
    }

    function mint(uint amount, address againstToken) external nonReentrant {
        MintConfig config = mintConfigs[againstToken];
        require(amount > 0, "Amount must be nonzero");
        require(!mintPaused, "Minting is paused");
        require(config.isEnabled, "Minting for this token is disabled");
        _requireActiveToken(mintableToken);
        _requireActiveToken(againstToken);
        require(config.maxBalance == 0 || (IERC20(againstToken).balanceOf(address(this)) <= config.maxBalance && amount <= config.maxBalance - IERC20(againstToken).balanceOf(address(this))), "Token balance cap exceeded");
        uint feeAmount = (amount * config.feeBps) / 10000;
        uint mintAmount = amount - feeAmount;
        require(mintAmount > 0, "Mint amount must be nonzero");

        // Pull funds from the user into the PSM
        _transferFrom(againstToken, msg.sender, address(this), amount);

        if (feeAmount > 0) {
            _transfer(againstToken, address(feeCollector), feeAmount);
        }
        Token(mintableToken).mint(msg.sender, mintAmount);
        emit DirectPSMMinted(msg.sender, amount, mintAmount, againstToken);
    }

    /// @dev Eligibility for redemption. Check order is load-bearing: the tests
    ///      assert these exact revert strings.
    function _requireRedeemable(address redeemToken) internal view {
        require(!burnPaused, "Burning is paused");
        require(burnConfigs[redeemToken].isEnabled, "Token burn is disabled");
        _requireActiveToken(mintableToken);
        _requireActiveToken(redeemToken);
    }

    /// @notice Burn mintableToken and receive redeemToken in a single transaction.
    function redeem(uint amount, address redeemToken) external nonReentrant returns (uint payoutAmount) {
        BurnConfig config = burnConfigs[redeemToken];
        require(amount > 0, "Amount must be nonzero");
        _requireRedeemable(redeemToken);
        payoutAmount = amount - ((amount * config.feeBps) / 10000);
        require(payoutAmount > 0, "Payout amount must be nonzero");
        require(availableRedemptionLiquidity(redeemToken) >= amount, "Insufficient liquidity");

        _transferFrom(mintableToken, msg.sender, address(this), amount);
        Token(mintableToken).burn(address(this), amount);

        // Settle the redeemToken side: fee to the collector, remainder to the redeemer.
        uint feeAmount = amount - payoutAmount;
        if (feeAmount > 0) {
            _transfer(redeemToken, address(feeCollector), feeAmount);
        }
        _transfer(redeemToken, msg.sender, payoutAmount);

        emit Redeemed(msg.sender, amount, payoutAmount, redeemToken);
        return payoutAmount;
    }
}
