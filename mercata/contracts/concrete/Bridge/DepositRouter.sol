pragma solidity ^0.8.26;

import "../../node_modules/@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../node_modules/@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "../../node_modules/@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "../../node_modules/@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../../node_modules/@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract DepositRouter is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // ============ Custom Errors ============
    error TokenNotAllowed();
    error UseDepositETH();
    error BelowMinimum();
    error InvalidAddress();
    error ETHTransferFailed();
    error ArrayLengthMismatch();
    error NoProposalActive();
    error ProposalStillPending();
    error ProposalExpired();
    error SameAddressProposed();

    //https://etherscan.io/address/0x000000000022d473030f116ddee9f6b43ac78ba3
    IPermit2 public constant PERMIT2 =
        IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    address private gnosisSafe;
    uint256 public depositId;

    // Two-step safe change security
    address public proposedSafe;
    uint256 public safeChangeProposedAt;
    uint256 public constant SAFE_CHANGE_DELAY = 48 hours;
    uint256 public constant MAX_SAFE_CHANGE_DELAY = 7 days;

    mapping(address => bool) public allowedTokens;
    mapping(address => uint256) public minDepositAmount;

    event DepositRouted(
        address indexed token,
        uint256 amount,
        address indexed sender,
        address indexed stratoAddress,
        uint256 depositId
    );

    event TokenAllowlistUpdated(address indexed token, bool allowed);
    event MinDepositAmountSet(address indexed token, uint256 minAmount);
    event GnosisSafeProposed(
        address indexed currentSafe,
        address indexed proposedSafe,
        uint256 executeAfter
    );
    event GnosisSafeUpdated(address indexed oldSafe, address indexed newSafe);
    event GnosisSafeProposalCancelled(address indexed proposedSafe);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address gnosisSafe_,
        address owner_
    ) public initializer {
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        if (gnosisSafe_ == address(0)) revert InvalidAddress();
        gnosisSafe = gnosisSafe_;
    }

    function deposit(
        address token,
        uint256 amount,
        address stratoAddress,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (token == address(0)) revert UseDepositETH();
        if (amount < minDepositAmount[token]) revert BelowMinimum();

        depositId++;

        IPermit2.PermitTransferFrom memory permit = IPermit2
            .PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({
                    token: token,
                    amount: amount
                }),
                nonce: nonce,
                deadline: deadline
            });

        IPermit2.SignatureTransferDetails memory transferDetails = IPermit2
            .SignatureTransferDetails({
                to: gnosisSafe,
                requestedAmount: amount
            });

        PERMIT2.permitTransferFrom(
            permit,
            transferDetails,
            msg.sender,
            signature
        );

        emit DepositRouted(token, amount, msg.sender, stratoAddress, depositId);
    }

    // using address(0) for ETH
    function depositETH(
        address stratoAddress
    ) external payable whenNotPaused nonReentrant {
        if (!allowedTokens[address(0)]) revert TokenNotAllowed();
        if (msg.value < minDepositAmount[address(0)]) revert BelowMinimum();

        depositId++;

        (bool success, ) = gnosisSafe.call{value: msg.value}("");
        if (!success) revert ETHTransferFailed();

        emit DepositRouted(
            address(0),
            msg.value,
            msg.sender,
            stratoAddress,
            depositId
        );
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowlistUpdated(token, allowed);
    }

    function setMinDepositAmount(
        address token,
        uint256 minAmount
    ) external onlyOwner {
        minDepositAmount[token] = minAmount;
        emit MinDepositAmountSet(token, minAmount);
    }

    function batchUpdateTokens(
        address[] calldata tokens,
        bool[] calldata allowed,
        uint256[] calldata minAmounts
    ) external onlyOwner {
        if (
            tokens.length != allowed.length ||
            tokens.length != minAmounts.length
        ) {
            revert ArrayLengthMismatch();
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            allowedTokens[tokens[i]] = allowed[i];
            minDepositAmount[tokens[i]] = minAmounts[i];
            emit TokenAllowlistUpdated(tokens[i], allowed[i]);
            emit MinDepositAmountSet(tokens[i], minAmounts[i]);
        }
    }

    function proposeSafeChange(address newSafe) external onlyOwner {
        if (newSafe == address(0)) revert InvalidAddress();
        if (newSafe == gnosisSafe) revert SameAddressProposed();

        proposedSafe = newSafe;
        safeChangeProposedAt = block.timestamp;

        emit GnosisSafeProposed(
            gnosisSafe,
            newSafe,
            block.timestamp + SAFE_CHANGE_DELAY
        );
    }

    function confirmSafeChange() external onlyOwner {
        if (block.timestamp < safeChangeProposedAt + SAFE_CHANGE_DELAY) {
            revert ProposalStillPending();
        }
        if (block.timestamp > safeChangeProposedAt + MAX_SAFE_CHANGE_DELAY) {
            revert ProposalExpired();
        }

        address oldSafe = gnosisSafe;
        address newSafe = proposedSafe;

        proposedSafe = address(0);
        safeChangeProposedAt = 0;

        gnosisSafe = newSafe;

        emit GnosisSafeUpdated(oldSafe, newSafe);
    }

    function cancelSafeChangeProposal() external onlyOwner {
        if (proposedSafe == address(0)) revert NoProposalActive();

        address cancelled = proposedSafe;
        proposedSafe = address(0);
        safeChangeProposedAt = 0;

        emit GnosisSafeProposalCancelled(cancelled);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function canDeposit(
        address token,
        uint256 amount
    ) external view returns (bool) {
        return
            !paused() &&
            allowedTokens[token] &&
            amount >= minDepositAmount[token];
    }

    function getTokenConfig(
        address token
    ) external view returns (bool allowed, uint256 minAmount) {
        return (allowedTokens[token], minDepositAmount[token]);
    }

    function getGnosisSafe() public view returns (address) {
        return gnosisSafe;
    }

    function getSafeChangeProposal()
        external
        view
        returns (
            address proposed,
            uint256 proposedAt,
            uint256 canExecuteAt,
            uint256 expiresAt,
            bool canExecute,
            bool hasExpired
        )
    {
        proposed = proposedSafe;
        proposedAt = safeChangeProposedAt;

        if (proposed != address(0)) {
            canExecuteAt = proposedAt + SAFE_CHANGE_DELAY;
            expiresAt = canExecuteAt + MAX_SAFE_CHANGE_DELAY;
            canExecute =
                block.timestamp >= canExecuteAt &&
                block.timestamp <= expiresAt;
            hasExpired = block.timestamp > expiresAt;
        }
    }

    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}

// see https://github.com/dragonfly-xyz/useful-solidity-patterns/blob/main/patterns/permit2/Permit2Vault.sol
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}
