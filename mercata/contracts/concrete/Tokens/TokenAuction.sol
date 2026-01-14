/**
 * @title TokenAuction
 * @notice Implements a fair auction mechanism for token launches
 * @dev Allows users to commit funds during an auction period, then claim proportional tokens
 *
 * The auction mechanism works as follows:
 * 1. Admin creates an auction with token details and parameters (duration, token amount, price bounds)
 * 2. Users commit USDST during the auction period
 * 3. After auction ends, final token price is calculated based on total commitments
 * 4. Users claim tokens proportional to their commitment at the final price
 * 5. Excess funds are refunded to users
 */

// SPDX-License-Identifier: MIT
import "./Token.sol";
import "./TokenFactory.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/// @notice Token auction contract for fair launches
contract record TokenAuction is Ownable {

    // ============ EVENTS ============

    /// @notice Event emitted when a new auction is created
    event AuctionCreated(uint256 indexed auctionId, address token, uint256 tokenAmount, uint256 startTime, uint256 endTime);

    /// @notice Event emitted when a user commits funds to an auction
    event CommitmentMade(uint256 indexed auctionId, address indexed user, uint256 amount);

    /// @notice Event emitted when an auction is finalized
    event AuctionFinalized(uint256 indexed auctionId, uint256 finalPrice, uint256 totalCommitments);

    /// @notice Event emitted when a user claims tokens
    event TokensClaimed(uint256 indexed auctionId, address indexed user, uint256 tokenAmount, uint256 refundAmount);

    // ============ STRUCTS ============

    /// @notice Auction status enum
    enum AuctionStatus {
        PENDING,    // Auction created but not started
        ACTIVE,     // Auction is accepting commitments
        ENDED,      // Auction ended, awaiting finalization
        FINALIZED,  // Auction finalized, users can claim
        CANCELLED   // Auction cancelled
    }

    /// @notice Auction data structure
    struct Auction {
        address token;              // Token being auctioned
        uint256 tokenAmount;        // Total tokens available in auction
        uint256 minPrice;           // Minimum price per token (in USDST)
        uint256 maxPrice;           // Maximum price per token (in USDST)
        uint256 startTime;          // Auction start timestamp
        uint256 endTime;            // Auction end timestamp
        uint256 totalCommitments;   // Total USDST committed
        uint256 finalPrice;         // Final price per token (calculated after auction ends)
        AuctionStatus status;       // Current auction status
    }

    /// @notice User commitment data structure
    struct UserCommitment {
        uint256 amount;             // Amount of USDST committed
        bool claimed;               // Whether user has claimed tokens
    }

    // ============ STATE VARIABLES ============

    /// @notice Counter for auction IDs
    uint256 public auctionCounter;

    /// @notice Mapping from auction ID to auction data
    mapping(uint256 => Auction) public auctions;

    /// @notice Mapping from auction ID to user address to commitment data
    mapping(uint256 => mapping(address => UserCommitment)) public commitments;

    /// @notice USDST token address
    address public usdstToken;

    /// @notice Token factory address
    address public tokenFactory;

    // ============ CONSTRUCTOR ============

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    /// @param _usdstToken Address of USDST token
    /// @param _tokenFactory Address of token factory
    constructor(address initialOwner, address _usdstToken, address _tokenFactory) Ownable(initialOwner) {
        usdstToken = _usdstToken;
        tokenFactory = _tokenFactory;
    }

    // ============ AUCTION MANAGEMENT ============

    /// @notice Create a new token auction
    /// @param _name Token name
    /// @param _description Token description
    /// @param _images Array of image URLs
    /// @param _files Array of file URLs
    /// @param _fileNames Array of file names
    /// @param _symbol Token symbol
    /// @param _tokenAmount Total tokens to auction
    /// @param _customDecimals Token decimals
    /// @param _minPrice Minimum price per token
    /// @param _maxPrice Maximum price per token
    /// @param _duration Auction duration in seconds
    /// @return Auction ID
    function createAuction(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        uint256 _tokenAmount,
        uint8 _customDecimals,
        uint256 _minPrice,
        uint256 _maxPrice,
        uint256 _duration
    ) external onlyOwner returns (uint256) {
        require(_tokenAmount > 0, "Token amount must be positive");
        require(_minPrice > 0 && _minPrice <= _maxPrice, "Invalid price bounds");
        require(_duration > 0, "Duration must be positive");

        // Create token through factory
        address tokenAddress = TokenFactory(tokenFactory).createTokenWithInitialOwner(
            _name,
            _description,
            _images,
            _files,
            _fileNames,
            _symbol,
            _tokenAmount,
            _customDecimals,
            address(this)  // Auction contract owns the tokens
        );

        // Create auction
        uint256 auctionId = auctionCounter++;
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + _duration;

        auctions[auctionId] = Auction({
            token: tokenAddress,
            tokenAmount: _tokenAmount,
            minPrice: _minPrice,
            maxPrice: _maxPrice,
            startTime: startTime,
            endTime: endTime,
            totalCommitments: 0,
            finalPrice: 0,
            status: AuctionStatus.ACTIVE
        });

        emit AuctionCreated(auctionId, tokenAddress, _tokenAmount, startTime, endTime);
        return auctionId;
    }

    /// @notice Commit USDST to an auction
    /// @param _auctionId Auction ID
    /// @param _amount Amount of USDST to commit
    function commit(uint256 _auctionId, uint256 _amount) external {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.ACTIVE, "Auction not active");
        require(block.timestamp >= auction.startTime && block.timestamp <= auction.endTime, "Auction not in progress");
        require(_amount > 0, "Amount must be positive");

        // Transfer USDST from user to this contract
        require(Token(usdstToken).transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        // Update commitment
        commitments[_auctionId][msg.sender].amount += _amount;
        auction.totalCommitments += _amount;

        emit CommitmentMade(_auctionId, msg.sender, _amount);
    }

    /// @notice Finalize an auction and calculate final price
    /// @param _auctionId Auction ID
    function finalizeAuction(uint256 _auctionId) external {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.ACTIVE, "Auction not active");
        require(block.timestamp > auction.endTime, "Auction not ended");

        auction.status = AuctionStatus.ENDED;

        if (auction.totalCommitments == 0) {
            // No commitments, cancel auction
            auction.status = AuctionStatus.CANCELLED;
            return;
        }

        // Calculate final price: totalCommitments / tokenAmount
        // This ensures all committed funds are used to purchase tokens
        uint256 calculatedPrice = (auction.totalCommitments * (10 ** 18)) / auction.tokenAmount;

        // Clamp price to min/max bounds
        if (calculatedPrice < auction.minPrice) {
            auction.finalPrice = auction.minPrice;
        } else if (calculatedPrice > auction.maxPrice) {
            auction.finalPrice = auction.maxPrice;
        } else {
            auction.finalPrice = calculatedPrice;
        }

        auction.status = AuctionStatus.FINALIZED;

        emit AuctionFinalized(_auctionId, auction.finalPrice, auction.totalCommitments);
    }

    /// @notice Claim tokens from a finalized auction
    /// @param _auctionId Auction ID
    function claimTokens(uint256 _auctionId) external {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.FINALIZED, "Auction not finalized");

        UserCommitment storage userCommitment = commitments[_auctionId][msg.sender];
        require(!userCommitment.claimed, "Already claimed");
        require(userCommitment.amount > 0, "No commitment");

        userCommitment.claimed = true;

        // Calculate tokens to receive: commitment / finalPrice
        uint256 tokensToReceive = (userCommitment.amount * (10 ** 18)) / auction.finalPrice;

        // Calculate actual cost: tokensToReceive * finalPrice
        uint256 actualCost = (tokensToReceive * auction.finalPrice) / (10 ** 18);

        // Calculate refund: commitment - actualCost
        uint256 refund = userCommitment.amount - actualCost;

        // Transfer tokens to user
        require(Token(auction.token).transfer(msg.sender, tokensToReceive), "Token transfer failed");

        // Refund excess USDST
        if (refund > 0) {
            require(Token(usdstToken).transfer(msg.sender, refund), "Refund failed");
        }

        emit TokensClaimed(_auctionId, msg.sender, tokensToReceive, refund);
    }

    /// @notice Cancel an auction (only if no commitments)
    /// @param _auctionId Auction ID
    function cancelAuction(uint256 _auctionId) external onlyOwner {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.ACTIVE || auction.status == AuctionStatus.PENDING, "Cannot cancel");
        require(auction.totalCommitments == 0, "Auction has commitments");

        auction.status = AuctionStatus.CANCELLED;

        // Return tokens to owner
        uint256 tokenAmount = Token(auction.token).balanceOf(address(this));
        if (tokenAmount > 0) {
            require(Token(auction.token).transfer(owner(), tokenAmount), "Token return failed");
        }
    }

    /// @notice Withdraw proceeds from a finalized auction
    /// @param _auctionId Auction ID
    function withdrawProceeds(uint256 _auctionId) external onlyOwner {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.FINALIZED, "Auction not finalized");

        // Calculate total proceeds: tokens sold * final price
        uint256 tokensSold = (auction.totalCommitments * (10 ** 18)) / auction.finalPrice;
        uint256 proceeds = (tokensSold * auction.finalPrice) / (10 ** 18);

        // Transfer proceeds to owner
        require(Token(usdstToken).transfer(owner(), proceeds), "Proceeds transfer failed");
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Get auction details
    /// @param _auctionId Auction ID
    /// @return Auction struct
    function getAuction(uint256 _auctionId) external view returns (Auction) {
        return auctions[_auctionId];
    }

    /// @notice Get user commitment
    /// @param _auctionId Auction ID
    /// @param _user User address
    /// @return UserCommitment struct
    function getUserCommitment(uint256 _auctionId, address _user) external view returns (UserCommitment) {
        return commitments[_auctionId][_user];
    }

    /// @notice Check if auction is active
    /// @param _auctionId Auction ID
    /// @return True if auction is active
    function isAuctionActive(uint256 _auctionId) external view returns (bool) {
        Auction storage auction = auctions[_auctionId];
        return auction.status == AuctionStatus.ACTIVE &&
               block.timestamp >= auction.startTime &&
               block.timestamp <= auction.endTime;
    }
}
