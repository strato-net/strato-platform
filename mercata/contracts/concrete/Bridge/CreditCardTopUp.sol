import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "./MercataBridge.sol";

/**
 * @title CreditCardTopUp
 * @dev Allows an operator (relayer) to initiate bridge-out on behalf of a user who has granted ERC-20 approval.
 * @notice Used for crypto credit card: when the user's card wallet balance dips below a threshold,
 *         the backend calls topUpCard to pull USDST from the user (via prior approval) and request a withdrawal to the card wallet.
 *         Card metadata (nickname, provider, network, token, wallet address) is stored on-chain per user.
 */
contract record CreditCardTopUp is Ownable {
    struct CardInfo {
        string nickname;
        string providerId;
        uint256 destinationChainId;
        address externalToken;
        address cardWalletAddress;
    }

    address public mercataBridge;
    address public operator;

    /// @dev user => list of card configs (nickname, provider, network, token, card wallet)
    mapping(address => CardInfo[]) public record userCards;

    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event MercataBridgeUpdated(address indexed previousBridge, address indexed newBridge);
    event TopUpRequested(address indexed user, uint256 stratoTokenAmount, uint256 externalChainId, address externalRecipient, uint256 withdrawalId);
    event CardAdded(address indexed user, uint256 index);
    event CardUpdated(address indexed user, uint256 index);
    event CardRemoved(address indexed user, uint256 index);

    error OnlyOperator();
    error ZeroAddress();
    error TransferFailed();
    error ApproveFailed();
    error AssetNotFound();
    error IndexOutOfBounds();

    modifier onlyOperator() {
        if (msg.sender != operator) revert OnlyOperator();
        _;
    }

    constructor(address _owner) Ownable(_owner) {}

    function setOperator(address _operator) external onlyOwner {
        if (_operator == address(0)) revert ZeroAddress();
        address previous = operator;
        operator = _operator;
        emit OperatorUpdated(previous, _operator);
    }

    function setMercataBridge(address _mercataBridge) external onlyOwner {
        if (_mercataBridge == address(0)) revert ZeroAddress();
        address previous = mercataBridge;
        mercataBridge = _mercataBridge;
        emit MercataBridgeUpdated(previous, _mercataBridge);
    }

    /**
     * @dev Operator pulls stratoToken from user (user must have approved this contract) and requests a withdrawal to the card wallet.
     * @param user STRATO address that granted approval and owns the tokens
     * @param stratoTokenAmount Amount of STRATO token (e.g. USDST) to bridge out
     * @param externalChainId Destination chain id
     * @param externalRecipient Card wallet address on the destination chain
     * @param externalToken External token address on the destination chain (used to look up stratoToken and asset config on MercataBridge)
     */
    function topUpCard(
        address user,
        uint256 stratoTokenAmount,
        uint256 externalChainId,
        address externalRecipient,
        address externalToken
    ) external onlyOperator returns (uint256 withdrawalId) {
        require(mercataBridge != address(0), "CCTU: bridge not set");
        require(user != address(0), "CCTU: zero user");
        require(stratoTokenAmount > 0, "CCTU: zero amount");
        require(externalRecipient != address(0), "CCTU: zero recipient");
        require(externalToken != address(0), "CCTU: zero external token");

        MercataBridge bridge = MercataBridge(mercataBridge);
        (,,,,,,, address stratoToken) = bridge.assets(externalToken, externalChainId);
        if (stratoToken == address(0)) revert AssetNotFound();

        if (!IERC20(stratoToken).transferFrom(user, address(this), stratoTokenAmount)) revert TransferFailed();
        if (!IERC20(stratoToken).approve(mercataBridge, stratoTokenAmount)) revert ApproveFailed();

        withdrawalId = bridge.requestWithdrawal(externalChainId, externalRecipient, externalToken, stratoTokenAmount);
        emit TopUpRequested(user, stratoTokenAmount, externalChainId, externalRecipient, withdrawalId);
        return withdrawalId;
    }

    /**
     * @dev Add a card for msg.sender.
     */
    function addCard(
        string calldata nickname,
        string calldata providerId,
        uint256 destinationChainId,
        address externalToken,
        address cardWalletAddress
    ) external {
        if (cardWalletAddress == address(0)) revert ZeroAddress();
        if (externalToken == address(0)) revert ZeroAddress();
        userCards[msg.sender].push(CardInfo({
            nickname: nickname,
            providerId: providerId,
            destinationChainId: destinationChainId,
            externalToken: externalToken,
            cardWalletAddress: cardWalletAddress
        }));
        emit CardAdded(msg.sender, userCards[msg.sender].length - 1);
    }

    /**
     * @dev Update card at index for msg.sender.
     */
    function updateCard(
        uint256 index,
        string calldata nickname,
        string calldata providerId,
        uint256 destinationChainId,
        address externalToken,
        address cardWalletAddress
    ) external {
        if (cardWalletAddress == address(0)) revert ZeroAddress();
        if (externalToken == address(0)) revert ZeroAddress();
        CardInfo[] storage cards = userCards[msg.sender];
        if (index >= cards.length) revert IndexOutOfBounds();
        cards[index] = CardInfo({
            nickname: nickname,
            providerId: providerId,
            destinationChainId: destinationChainId,
            externalToken: externalToken,
            cardWalletAddress: cardWalletAddress
        });
        emit CardUpdated(msg.sender, index);
    }

    /**
     * @dev Remove card at index for msg.sender (swap with last and pop).
     */
    function removeCard(uint256 index) external {
        CardInfo[] storage cards = userCards[msg.sender];
        if (index >= cards.length) revert IndexOutOfBounds();
        uint256 last = cards.length - 1;
        if (index != last) {
            cards[index] = cards[last];
        }
        delete cards[cards.length-1];
        cards.length -= 1;
        emit CardRemoved(msg.sender, index);
    }

    /**
     * @dev Return all cards for a user (convenience for frontend).
     */
    function getCards(address user) external view returns (CardInfo[] memory) {
        return userCards[user];
    }
}
