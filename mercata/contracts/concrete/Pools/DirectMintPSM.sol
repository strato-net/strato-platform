import "../../abstract/ERC20/access/Ownable.sol";
import "../Admin/FeeCollector.sol";
import "../Tokens/Token.sol";

contract DirectMintPSM is Ownable {

    struct MintConfig {
        bool isEnabled;
        uint maxBalance;
        uint feeBps;
    }

    struct BurnConfig {
        bool isEnabled;
        uint minReserve;
        uint burnDelay;
        uint feeBps;
    }

    struct BurnRequest {
        uint burnAmount;
        uint payoutAmount;
        address redeemToken;
        address requester;
        uint requestTime;
    }

    address public mintableToken;
    FeeCollector public feeCollector;
    mapping(address => MintConfig) public record mintConfigs;
    mapping(address => BurnConfig) public record burnConfigs;
    mapping(address => uint) public record pendingRedemptions;
    uint public burnReqCounter; // follows MercataBridge.withdrawalCounter pattern
    mapping(uint => BurnRequest) public burnRequests;

    event MintConfigSet(address token, bool isEnabled, uint maxBalance, uint feeBps);
    event BurnConfigSet(address token, bool isEnabled, uint minReserve, uint burnDelay, uint feeBps);
    event BurnRequested(uint id, uint burnAmount, uint payoutAmount, address redeemToken, address requester, uint requestTime);
    event BurnCompleted(uint id, uint burnAmount, uint payoutAmount, address redeemToken, address recipient);
    event BurnCancelled(uint id, uint burnAmount, address redeemToken, address requester);
    event DirectPSMMinted(address user, uint depositAmount, uint mintAmount, address againstToken);
    event FeeCollectorSet(address feeCollector);

    bool private reentrancyLock;
    modifier nonReentrant() {
        require(!reentrancyLock, "REENTRANT");
        reentrancyLock = true;
        _;
        reentrancyLock = false;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _mintableToken, address _feeCollector, address[] _eligibleTokens, uint _burnDelay) external onlyOwner {
        require(_mintableToken != address(0), "Invalid mintable token");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_eligibleTokens.length > 0, "Invalid eligible tokens");
        mintableToken = _mintableToken;
        feeCollector = FeeCollector(_feeCollector);
        emit FeeCollectorSet(_feeCollector);
        for (uint i = 0; i < _eligibleTokens.length; i++) {
            setMintConfig(_eligibleTokens[i], true, 0, 0);
            setBurnConfig(_eligibleTokens[i], true, 0, _burnDelay, 0);
        }
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid fee collector");
        feeCollector = FeeCollector(_feeCollector);
        emit FeeCollectorSet(_feeCollector);
    }

    function _requireValidConfigToken(address token) internal view {
        require(token != address(0) && token != mintableToken, "Invalid token");
        require(Token(token).decimals() == Token(mintableToken).decimals(), "Decimal mismatch"); // unsupported
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
        uint _burnDelay,
        uint _feeBps
    ) public onlyOwner {
        _requireValidConfigToken(token);
        require(_feeBps <= 10000, "Invalid fee bps");

        burnConfigs[token] = BurnConfig(
            _isEnabled,
            _minReserve,
            _burnDelay,
            _feeBps
        );

        emit BurnConfigSet(token, _isEnabled, _minReserve, _burnDelay, _feeBps);
    }

    function setBurnEnabled(address token, bool _isEnabled) external onlyOwner {
        _requireValidConfigToken(token);
        burnConfigs[token].isEnabled = _isEnabled;
        emit BurnConfigSet(token, _isEnabled, burnConfigs[token].minReserve, burnConfigs[token].burnDelay, burnConfigs[token].feeBps);
    }

    function setBurnMinReserve(address token, uint _minReserve) external onlyOwner {
        _requireValidConfigToken(token);
        burnConfigs[token].minReserve = _minReserve;
        emit BurnConfigSet(token, burnConfigs[token].isEnabled, _minReserve, burnConfigs[token].burnDelay, burnConfigs[token].feeBps);
    }

    function setBurnDelay(address token, uint _burnDelay) external onlyOwner {
        _requireValidConfigToken(token);
        burnConfigs[token].burnDelay = _burnDelay;
        emit BurnConfigSet(token, burnConfigs[token].isEnabled, burnConfigs[token].minReserve, _burnDelay, burnConfigs[token].feeBps);
    }

    function setBurnFeeBps(address token, uint _feeBps) external onlyOwner {
        _requireValidConfigToken(token);
        require(_feeBps <= 10000, "Invalid fee bps");
        burnConfigs[token].feeBps = _feeBps;
        emit BurnConfigSet(token, burnConfigs[token].isEnabled, burnConfigs[token].minReserve, burnConfigs[token].burnDelay, _feeBps);
    }

    function availableRedemptionLiquidity(address token) public view returns (uint) {
        uint balance = IERC20(token).balanceOf(address(this));
        uint reserved = pendingRedemptions[token];
        if (balance <= reserved) return 0;
        uint unreserved = balance - reserved;
        uint minReserve = burnConfigs[token].minReserve;
        if (unreserved <= minReserve) return 0;
        return unreserved - minReserve;
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
        require(config.isEnabled, "Minting for this token is disabled");
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

    function _deleteBurnRequest(uint id) internal {
        delete burnRequests[id].burnAmount;
        delete burnRequests[id].payoutAmount;
        delete burnRequests[id].redeemToken;
        delete burnRequests[id].requester;
        delete burnRequests[id].requestTime;
    }

    function requestBurn(uint amount, address redeemToken) external nonReentrant returns (uint) {
        BurnConfig config = burnConfigs[redeemToken];
        require(amount > 0, "Amount must be nonzero");
        require(config.isEnabled, "Token burn is disabled");
        uint payoutAmount = amount - ((amount * config.feeBps) / 10000);
        require(payoutAmount > 0, "Payout amount must be nonzero");
        require(availableRedemptionLiquidity(redeemToken) >= amount, "Insufficient liquidity");

        // Escrow mintableToken in this contract's balance
        _transferFrom(mintableToken, msg.sender, address(this), amount);

        // Reserve payout liquidity for this request
        pendingRedemptions[redeemToken] += amount;

        // Create burn request
        burnRequests[++burnReqCounter] = BurnRequest(amount, payoutAmount, redeemToken, msg.sender, block.timestamp);
        emit BurnRequested(burnReqCounter, amount, payoutAmount, redeemToken, msg.sender, block.timestamp);
        return burnReqCounter;
    }

    function completeBurn(uint id) nonReentrant external {
        // Local copy
        uint burnAmount = burnRequests[id].burnAmount;
        uint payoutAmount = burnRequests[id].payoutAmount;
        address redeemToken = burnRequests[id].redeemToken;
        address requester = burnRequests[id].requester;
        uint requestTime = burnRequests[id].requestTime;

        // Ensure eligibility
        require(burnAmount > 0, "Invalid burn request ID");
        require(burnConfigs[redeemToken].isEnabled, "Token burn is disabled");
        require(requester == msg.sender, "Unauthorized");
        uint burnDelay = burnConfigs[redeemToken].burnDelay;
        require(burnDelay == 0 || requestTime + burnDelay <= block.timestamp, "Burn delay not passed");

        // Remove burn request
        _deleteBurnRequest(id);

        // Release reserved payout liquidity
        pendingRedemptions[redeemToken] -= burnAmount;

        // Burn escrowed mintable token
        Token(mintableToken).burn(address(this), burnAmount);

        // Check payout token availability
        uint feeAmount = burnAmount - payoutAmount;
        require(IERC20(redeemToken).balanceOf(address(this)) >= burnAmount, "Insufficient liquidity");

        if (feeAmount > 0) {
            _transfer(redeemToken, address(feeCollector), feeAmount);
        }
        _transfer(redeemToken, requester, payoutAmount);

        emit BurnCompleted(id, burnAmount, payoutAmount, redeemToken, requester);
    }

    function cancelBurn(uint id) nonReentrant external {
        // Local copy
        uint burnAmount = burnRequests[id].burnAmount;
        uint payoutAmount = burnRequests[id].payoutAmount;
        address redeemToken = burnRequests[id].redeemToken;
        address requester = burnRequests[id].requester;
        uint requestTime = burnRequests[id].requestTime;

        // Validate request
        require(burnAmount > 0, "Invalid burn request ID");
        require(requester == msg.sender, "Unauthorized");

        // Remove burn request
        _deleteBurnRequest(id);

        // Release reserved payout liquidity
        pendingRedemptions[redeemToken] -= burnAmount;

        // Check liquidity
        require(IERC20(mintableToken).balanceOf(address(this)) >= burnAmount, "Insufficient liquidity");

        // Return escrowed mintable token to the requester
        _transfer(mintableToken, requester, burnAmount);

        emit BurnCancelled(id, burnAmount, redeemToken, requester);
    }
}
