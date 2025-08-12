pragma solidity ^0.8.26;

import "../../node_modules/@openzeppelin/contracts/access/Ownable.sol";
import "../../node_modules/@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../node_modules/@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../node_modules/@openzeppelin/contracts/utils/Pausable.sol";

contract DepositRouter is Ownable, ReentrancyGuard, Pausable {
    //https://etherscan.io/address/0x000000000022d473030f116ddee9f6b43ac78ba3
    IPermit2 public constant PERMIT2 =
        IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    address public immutable gnosisSafe;
    uint256 public depositId;

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

    constructor(address _gnosisSafe) Ownable(msg.sender) {
        gnosisSafe = _gnosisSafe;
    }

    function deposit(
        address token,
        uint256 amount,
        address stratoAddress,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        require(allowedTokens[token], "Token not allowed");
        require(token != address(0), "Use depositETH()");
        require(amount >= minDepositAmount[token], "Below minimum");

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
        require(allowedTokens[address(0)], "ETH not allowed");
        require(msg.value >= minDepositAmount[address(0)], "Below minimum");

        depositId++;

        (bool success, ) = gnosisSafe.call{value: msg.value}("");
        require(success, "ETH transfer failed");

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
        require(
            tokens.length == allowed.length &&
                tokens.length == minAmounts.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < tokens.length; i++) {
            allowedTokens[tokens[i]] = allowed[i];
            minDepositAmount[tokens[i]] = minAmounts[i];
            emit TokenAllowlistUpdated(tokens[i], allowed[i]);
            emit MinDepositAmountSet(tokens[i], minAmounts[i]);
        }
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
