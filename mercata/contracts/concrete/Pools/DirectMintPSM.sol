import "../../abstract/ERC20/access/Ownable.sol";
import "../Tokens/Token.sol";

contract DirectMintPSM is Ownable {

    struct BurnRequest {
        uint amount;
        address redeemToken;
        address requester;
        uint requestTime;
    }

    address public mintableToken;
    mapping(address => bool) public eligibleTokens;
    uint public burnReqCounter; // follows MercataBridge.withdrawalCounter pattern
    mapping(uint => BurnRequest) public burnRequests;
    uint public burnDelay;

    event EligibleTokenAdded(address token);
    event EligibleTokenRemoved(address token);
    event BurnDelaySet(uint burnDelay);
    event BurnRequested(uint id, uint amount, address redeemToken, address requester, uint requestTime);
    event BurnCompleted(uint id, uint amount, address redeemToken, address recipient);
    event BurnCancelled(uint id, uint amount, address redeemToken, address requester);
    event DirectPSMMinted(address user, uint amount, address againstToken);

    modifier isEligible(address token) {
        require(eligibleTokens[token], "Token is not eligible");
        _;
    }

    bool private reentrancyLock;
    modifier nonReentrant() {
        require(!reentrancyLock, "REENTRANT");
        reentrancyLock = true;
        _;
        reentrancyLock = false;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _mintableToken, address[] _eligibleTokens, uint _burnDelay) external onlyOwner {
        require(_mintableToken != address(0), "Invalid mintable token");
        require(_eligibleTokens.length > 0, "Invalid eligible tokens");
        mintableToken = _mintableToken;
        for (uint i = 0; i < _eligibleTokens.length; i++) {
            addEligibleToken(_eligibleTokens[i]);
        }
        setBurnDelay(_burnDelay);
    }

    function addEligibleToken(address token) public onlyOwner {
        require(token != address(0) && token != mintableToken, "Invalid token");
        require(Token(token).decimals() == Token(mintableToken).decimals(), "Decimal mismatch"); // unsupported
        eligibleTokens[token] = true;
        emit EligibleTokenAdded(token);
    }

    function removeEligibleToken(address token) external onlyOwner {
        require(eligibleTokens[token], "Token is already ineligible");
        eligibleTokens[token] = false;
        emit EligibleTokenRemoved(token);
    }

    function setBurnDelay(uint _burnDelay) public onlyOwner {
        burnDelay = _burnDelay;
        emit BurnDelaySet(_burnDelay);
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

    function mint(uint amount, address againstToken) external nonReentrant isEligible(againstToken) {
        require(amount > 0, "Amount must be nonzero");

        // Pull funds from the user into the PSM
        _transferFrom(againstToken, msg.sender, address(this), amount);

        // Mint 1:1 mintableToken to the user
        Token(mintableToken).mint(msg.sender, amount);

        emit DirectPSMMinted(msg.sender, amount, againstToken);
    }

    function _deleteBurnRequest(uint id) internal {
        delete burnRequests[id].amount;
        delete burnRequests[id].redeemToken;
        delete burnRequests[id].requester;
        delete burnRequests[id].requestTime;
    }

    function requestBurn(uint amount, address redeemToken) external nonReentrant isEligible(redeemToken) returns (uint) {
        require(amount > 0, "Amount must be nonzero");

        // Escrow mintableToken in this contract's balance
        _transferFrom(mintableToken, msg.sender, address(this), amount);

        // Create burn request
        burnRequests[++burnReqCounter] = BurnRequest(amount, redeemToken, msg.sender, block.timestamp);
        emit BurnRequested(burnReqCounter, amount, redeemToken, msg.sender, block.timestamp);
        return burnReqCounter;
    }

    function completeBurn(uint id) nonReentrant external {
        // Local copy
        uint amount = burnRequests[id].amount;
        address redeemToken = burnRequests[id].redeemToken;
        address requester = burnRequests[id].requester;
        uint requestTime = burnRequests[id].requestTime;

        // Ensure eligibility
        require(amount > 0, "Invalid burn request ID");
        require(eligibleTokens[redeemToken], "Redeem token is not eligible");
        require(requester == msg.sender, "Unauthorized");
        require(burnDelay == 0 || requestTime + burnDelay <= block.timestamp, "Burn delay not passed");

        // Remove burn request
        _deleteBurnRequest(id);

        // Burn escrowed mintable token
        Token(mintableToken).burn(address(this), amount);

        // Check eligibleToken availability
        require(IERC20(redeemToken).balanceOf(address(this)) >= amount, "Insufficient liquidity");

        // Redeem 1:1 with eligible token
        _transfer(redeemToken, requester, amount);

        emit BurnCompleted(id, amount, redeemToken, requester);
    }

    function cancelBurn(uint id) nonReentrant external {
        // Local copy
        uint amount = burnRequests[id].amount;
        address redeemToken = burnRequests[id].redeemToken;
        address requester = burnRequests[id].requester;
        uint requestTime = burnRequests[id].requestTime;

        // Validate request
        require(amount > 0, "Invalid burn request ID");
        require(requester == msg.sender, "Unauthorized");

        // Remove burn request
        _deleteBurnRequest(id);

        // Return escrowed mintable token to the requester
        _transfer(mintableToken, requester, amount);

        emit BurnCancelled(id, amount, redeemToken, requester);
    }
}
