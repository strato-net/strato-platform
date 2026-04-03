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

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _mintableToken, address[] memory _eligibleTokens, uint _burnDelay) external onlyOwner {
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

    function mint(uint amount, address againstToken) external isEligible(againstToken) {
        require(amount > 0);

        // Pull funds from the user into the PSM
        require(IERC20(againstToken).transferFrom(msg.sender, address(this), amount), "Transfer failed");

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

    function requestBurn(uint amount, address redeemToken) external isEligible(redeemToken) returns (uint) {
        burnRequests[++burnReqCounter] = BurnRequest(amount, redeemToken, msg.sender, block.timestamp);
        emit BurnRequested(burnReqCounter, amount, redeemToken, msg.sender, block.timestamp);
        return burnReqCounter;
    }

    function completeBurn(uint id) external {
        // Local copy
        uint amount = burnRequests[id].amount;
        address redeemToken = burnRequests[id].redeemToken;
        address requester = burnRequests[id].requester;
        uint requestTime = burnRequests[id].requestTime;

        // Ensure eligibility
        require(eligibleTokens[redeemToken], "Redeem token is not eligible");
        require(burnDelay == 0 || requestTime + burnDelay <= block.timestamp, "Burn delay not passed");
        require(requester == msg.sender, "Unauthorized");

        // Remove burn request
        _deleteBurnRequest(id);

        // Burn mintable token
        Token(mintableToken).burn(address(msg.sender), amount);

        // Redeem 1:1 with eligible token
        require(IERC20(redeemToken).transfer(msg.sender, amount), "Transfer failed");

        emit BurnCompleted(id, amount, redeemToken, requester);
    }

    function cancelBurn(uint id) external {
        BurnRequest memory request = burnRequests[id];
        require(request.requester == msg.sender, "Unauthorized");

        // Remove burn request
        delete burnRequests[id];

        emit BurnCancelled(id, request.amount, request.redeemToken, request.requester);
    }
}
