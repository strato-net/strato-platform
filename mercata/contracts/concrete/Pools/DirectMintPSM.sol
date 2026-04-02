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
    uint public nonce; // follows MercataBridge.withdrawalCounter pattern
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

    function removeEligibleToken(address token) public onlyOwner {
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

    function requestBurn(uint amount, address redeemToken) external isEligible(redeemToken) returns (uint) {
        burnRequests[nonce] = BurnRequest(amount, redeemToken, msg.sender, block.timestamp);
        emit BurnRequested(nonce, amount, redeemToken, msg.sender, block.timestamp);
        return nonce++;
    }

    function completeBurn(uint id) external {
        BurnRequest memory request = burnRequests[id];
        require(eligibleTokens[request.redeemToken], "Redeem token is not eligible");
        require(burnDelay == 0 || request.requestTime + burnDelay <= block.timestamp, "Burn delay not passed");
        require(request.requester == msg.sender, "Unauthorized");

        // Burn mintable token
        Token(mintableToken).burn(address(msg.sender), request.amount);

        // Redeem 1:1 with eligible token
        require(IERC20(request.redeemToken).transfer(msg.sender, request.amount), "Transfer failed");

        // Remove burn request
        delete burnRequests[id];

        emit BurnCompleted(id, request.amount, request.redeemToken, request.requester);
    }

    function cancelBurn(uint id) external {
        BurnRequest memory request = burnRequests[id];
        require(request.requester == msg.sender, "Unauthorized");

        // Remove burn request
        delete burnRequests[id];

        emit BurnCancelled(id, request.amount, request.redeemToken, request.requester);
    }
}
