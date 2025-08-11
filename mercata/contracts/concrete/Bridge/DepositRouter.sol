pragma solidity ^0.8.26;

import "../../node_modules/@openzeppelin/contracts/access/Ownable.sol";
import "../../node_modules/@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../node_modules/@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../node_modules/@openzeppelin/contracts/utils/Pausable.sol";

contract DepositRouter is Ownable, ReentrancyGuard, Pausable {
    address public immutable gnosisSafe;
    uint256 public depositNonce;

    mapping(address => bool) public allowedTokens;
    mapping(address => uint256) public minDepositAmount;

    event DepositRouted(
        address indexed token,
        uint256 amount,
        address indexed sender,
        bytes32 indexed stratoAddress,
        uint256 nonce
    );

    event TokenAllowlistUpdated(address indexed token, bool allowed);
    event MinDepositAmountSet(address indexed token, uint256 minAmount);

    constructor(address _gnosisSafe) Ownable(msg.sender) {
        gnosisSafe = _gnosisSafe;
    }

    function deposit(
        address token,
        uint256 amount,
        bytes32 stratoAddress
    ) external whenNotPaused nonReentrant {
        require(allowedTokens[token], "Token not allowed");
        require(amount >= minDepositAmount[token], "Below minimum");

        depositNonce++;

        SafeERC20.safeTransferFrom(
            IERC20(token),
            msg.sender,
            gnosisSafe,
            amount
        );

        emit DepositRouted(
            token,
            amount,
            msg.sender,
            stratoAddress,
            depositNonce
        );
    }

    // using address(0) for ETH
    function depositETH(
        bytes32 stratoAddress
    ) external payable whenNotPaused nonReentrant {
        require(allowedTokens[address(0)], "ETH not allowed");
        require(msg.value >= minDepositAmount[address(0)], "Below minimum");

        depositNonce++;

        (bool success, ) = gnosisSafe.call{value: msg.value}("");
        require(success, "ETH transfer failed");

        emit DepositRouted(
            address(0),
            msg.value,
            msg.sender,
            stratoAddress,
            depositNonce
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
