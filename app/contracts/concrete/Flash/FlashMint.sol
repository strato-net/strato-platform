// SPDX-License-Identifier: MIT

/*
 * FlashMint
 * - Atomic, supply-neutral token liquidity: mint to the borrower, call back, burn what was minted.
 * - Adds zero new economic state. Nothing is lent, so nothing can be lost: if the borrower does
 *   not hold amount + fee when the callback returns, the whole transaction reverts and the mint
 *   never happened.
 * - Must be whitelisted to mint and burn the configured token, e.g.
 *   AdminRegistry.whitelist[USDST]["mint"|"burn"][FlashMint]. No other contract is modified.
 *
 * Risk dials, all owner (AdminRegistry) controlled:
 *   maxLoan           hard per-loan ceiling; 0 disables the facility entirely
 *   feeBps            routed to FeeCollector by minting; waived for whitelist[]
 *   paused            kill switch
 *   whitelistEnabled  when true only whitelist[] borrowers may draw; flip off to go permissionless
 */

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../Tokens/Token.sol";

/// @notice Borrowers implement this. The magic return string is the borrower's acknowledgement
///         that it understands the loan contract, mirroring ERC-3156's return-value handshake.
interface IFlashMintReceiver {
    function onFlashMint(
        address token,
        uint amount,
        uint fee,
        variadic data
    ) external returns (string);
}

    contract record FlashMint is Ownable {

    // ───────────────────────────── State ─────────────────────────────

    /// @notice The only token this facility can mint.
    address public token;

    /// @notice Destination for flash fees.
    address public feeCollector;

    /// @notice Hard per-loan ceiling, in token units. 0 = facility disabled.
    uint public maxLoan;

    /// @notice Fee charged on the principal, in bps. Waived for whitelist[] borrowers.
    uint public feeBps;

    /// @notice Expected callback return value.
    string public CALLBACK_OK;

    bool public paused;

    /// @notice While true, only whitelisted borrowers may draw.
    bool public whitelistEnabled;
    mapping(address => bool) public record whitelist;

    // Telemetry — cheap, and makes the facility auditable from Cirrus without log scraping.
    uint public loansServed;
    uint public feesAccrued;
    uint public largestLoan;

    bool private locked;

    // ───────────────────────────── Events ─────────────────────────────

    event FlashMintExecuted(address indexed borrower, address indexed token, uint amount, uint fee);
    event MaxLoanSet(uint newMaxLoan);
    event FeeBpsSet(uint newFeeBps);
    event FeeCollectorSet(address newFeeCollector);
    event PausedSet(bool isPaused);
    event WhitelistEnabledSet(bool isEnabled);
    event WhitelistSet(address indexed borrower, bool isWhitelisted);

    modifier nonReentrant() {
        require(!locked, "FlashMint: reentrant");
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialOwner) Ownable(initialOwner) { }

    /**
     * @notice Wire the facility. Pass maxLoan 0 to keep it closed; whitelist starts on.
     */
    function initialize(address _token, address _feeCollector, uint _maxLoan) external onlyOwner {
        require(_token != address(0), "FlashMint: invalid token");
        require(_feeCollector != address(0), "FlashMint: invalid feeCollector");

        token        = _token;
        feeCollector = _feeCollector;

        CALLBACK_OK  = "FlashMint.onFlashMint";

        maxLoan           = _maxLoan;
        feeBps            = 0;
        paused            = false;
        whitelistEnabled  = true;                // opt-in at launch
        locked            = false;
    }

    // ───────────────────────────── Governance ─────────────────────────────

    function setMaxLoan(uint newMaxLoan) external onlyOwner {
        maxLoan = newMaxLoan;
        emit MaxLoanSet(maxLoan);
    }

    function setFeeBps(uint newFeeBps) external onlyOwner {
        feeBps = newFeeBps;
        emit FeeBpsSet(newFeeBps);
    }

    function setFeeCollector(address newFeeCollector) external onlyOwner {
        require(newFeeCollector != address(0), "FlashMint: invalid feeCollector");
        feeCollector = newFeeCollector;
        emit FeeCollectorSet(feeCollector);
    }

    function setPaused(bool isPaused) external onlyOwner {
        paused = isPaused;
        emit PausedSet(isPaused);
    }

    function setWhitelistEnabled(bool isEnabled) external onlyOwner {
        whitelistEnabled = isEnabled;
        emit WhitelistEnabledSet(isEnabled);
    }

    function setWhitelist(address borrower, bool isWhitelisted) external onlyOwner {
        require(borrower != address(0), "FlashMint: invalid borrower");
        whitelist[borrower] = isWhitelisted;
        emit WhitelistSet(borrower, isWhitelisted);
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice Maximum drawable right now, 0 when unavailable.
    function maxFlashLoan() external view returns (uint) {
        if (paused || !_tokenLive()) return 0;
        return maxLoan;
    }

    /// @notice Whether `borrower` may draw right now.
    function canBorrow(address borrower) external view returns (bool) {
        if (paused || maxLoan == 0 || !_tokenLive()) return false;
        return !whitelistEnabled || whitelist[borrower];
    }

    /// @dev Token.pause() and a non-ACTIVE status are the operators' emergency brake.
    function _tokenLive() private view returns (bool) {
        if (token == address(0)) return false;
        Token t = Token(token);
        return !t.paused() && t.status() == TokenStatus.ACTIVE;
    }

    // ───────────────────────────── Core ─────────────────────────────

    /**
     * @notice Mint `amount` of `token` to the caller, hand control back to it, then burn the
     *         principal and route the fee. Reverts unless the caller holds amount + fee when
     *         its callback returns.
     * @param receiver Must equal msg.sender; kept as a parameter for ERC-3156 call-shape parity.
     * @param amount   Principal to mint.
     * @param data     Opaque payload forwarded to the callback.
     */
    function flashLoan(
        address receiver,
        uint amount,
        variadic data
    ) external nonReentrant returns (bool) {
        require(!paused, "FlashMint: paused");
        require(!Token(token).paused(), "FlashMint: token paused");
        require(Token(token).status() == TokenStatus.ACTIVE, "FlashMint: token disabled");
        require(receiver == msg.sender, "FlashMint: receiver must be caller");
        require(amount > 0, "FlashMint: zero amount");
        require(maxLoan > 0, "FlashMint: facility disabled");
        require(amount <= maxLoan, "FlashMint: exceeds maxLoan");
        require(!whitelistEnabled || whitelist[msg.sender], "FlashMint: not whitelisted");

        uint fee = whitelist[msg.sender] ? 0 : (amount * feeBps) / 10000;

        Token(token).mint(receiver, amount);

        string ack = IFlashMintReceiver(receiver).onFlashMint(token, amount, fee, data);
        require(ack == CALLBACK_OK, "FlashMint: bad callback ack");

        require(IERC20(token).balanceOf(receiver) >= amount + fee, "FlashMint: not repaid");

        Token(token).burn(receiver, amount + fee);
        if (fee > 0) {
            Token(token).mint(feeCollector, fee);
            feesAccrued += fee;
        }

        loansServed += 1;
        if (amount > largestLoan) largestLoan = amount;

        emit FlashMintExecuted(receiver, token, amount, fee);
        return true;
    }
}
