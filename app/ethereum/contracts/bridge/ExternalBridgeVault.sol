// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ExternalBridgeVault
/// @notice Holds canonical external assets and releases them against threshold-signed STRATO withdrawal authorizations.
contract ExternalBridgeVault is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
    bytes32 public constant ATTESTATION_ADMIN_ROLE = keccak256("ATTESTATION_ADMIN_ROLE");
    bytes32 public constant LARGE_WITHDRAWAL_APPROVER_ROLE =
        keccak256("LARGE_WITHDRAWAL_APPROVER_ROLE");

    bytes32 private constant WITHDRAWAL_AUTHORIZATION_TYPEHASH = keccak256(
        "WithdrawalAuthorization(uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId,uint256 destinationChainId,address destinationVault,address token,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,uint256 signerSetVersion)"
    );
    bytes32 private constant WITHDRAWAL_REVIEW_TYPEHASH = keccak256(
        "WithdrawalReview(uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId,uint256 destinationChainId,address destinationVault,address token,address recipient,uint256 amount)"
    );

    enum ReservationStatus {
        NONE,
        RESERVED,
        RELEASED,
        CANCELLED
    }

    struct WithdrawalAuthorization {
        uint256 sourceChainId;
        address sourceBridge;
        uint256 sourceWithdrawalId;
        uint256 destinationChainId;
        address destinationVault;
        address token;
        address recipient;
        uint256 amount;
        uint256 notBefore;
        uint256 deadline;
        uint256 signerSetVersion;
    }

    struct Reservation {
        ReservationStatus status;
        address token;
        address recipient;
        uint256 amount;
        uint256 deadline;
        bytes32 authorizationDigest;
    }

    struct TokenPolicy {
        bool enabled;
        uint256 maxPerWithdrawal;
        uint256 windowLimit;
        uint256 windowSeconds;
        uint256 windowStartedAt;
        uint256 releasedInWindow;
        uint256 manualReviewThreshold;
    }

    mapping(address => TokenPolicy) public tokenPolicies;
    mapping(address => uint256) public totalReserved;
    mapping(bytes32 => Reservation) public reservations;
    mapping(address => bool) public attestationSigners;
    mapping(bytes32 => uint256) public largeWithdrawalApprovalDeadline;
    mapping(uint256 => mapping(address => bool)) public sourceBridges;

    uint8 public attestationThreshold;
    uint8 public attestationSignerCount;
    uint256 public signerSetVersion;
    uint256 public maxAuthorizationValiditySeconds;

    event TokenPolicyUpdated(
        address indexed token,
        bool enabled,
        uint256 maxPerWithdrawal,
        uint256 windowLimit,
        uint256 windowSeconds,
        uint256 manualReviewThreshold
    );
    event WithdrawalReserved(
        bytes32 indexed reservationId,
        bytes32 indexed authorizationDigest,
        uint256 indexed sourceWithdrawalId,
        address token,
        address recipient,
        uint256 amount,
        uint256 deadline
    );
    event WithdrawalReleased(
        bytes32 indexed reservationId,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );
    event WithdrawalCancelled(bytes32 indexed reservationId);
    event LargeWithdrawalApproved(
        bytes32 indexed authorizationDigest,
        uint256 approvalDeadline
    );
    event LargeWithdrawalApprovalRevoked(bytes32 indexed authorizationDigest);
    event AttestationSignerUpdated(
        address indexed signer,
        bool enabled,
        uint256 signerSetVersion
    );
    event AttestationThresholdUpdated(
        uint8 threshold,
        uint256 signerSetVersion
    );
    event MaxAuthorizationValidityUpdated(
        uint256 previousValiditySeconds,
        uint256 newValiditySeconds
    );
    event SourceBridgeUpdated(
        uint256 indexed sourceChainId,
        address indexed sourceBridge,
        bool enabled
    );

    error InvalidAddress();
    error InvalidAmount();
    error InvalidAuthorization();
    error AuthorizationNotReady();
    error AuthorizationExpired();
    error AuthorizationValidityTooLong();
    error InvalidAttestationThreshold();
    error BadAttestationSignatures();
    error StaleSignerSet();
    error SourceBridgeDisabled();
    error TokenDisabled();
    error PerWithdrawalLimitExceeded();
    error WindowLimitExceeded();
    error InsufficientLiquidity();
    error LargeWithdrawalApprovalRequired();
    error InvalidReservationState();
    error ReservationNotExpired();
    error ETHTransferFailed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address defaultAdmin,
        address upgrader,
        address policyAdmin,
        address guardian,
        address unpauser,
        address attestationAdmin,
        address largeWithdrawalApprover
    ) external initializer {
        if (
            defaultAdmin == address(0) ||
            upgrader == address(0) ||
            policyAdmin == address(0) ||
            guardian == address(0) ||
            unpauser == address(0) ||
            attestationAdmin == address(0) ||
            largeWithdrawalApprover == address(0)
        ) {
            revert InvalidAddress();
        }

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __EIP712_init("ExternalBridgeVault", "1");
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(UPGRADER_ROLE, upgrader);
        _grantRole(POLICY_ADMIN_ROLE, policyAdmin);
        _grantRole(PAUSER_ROLE, guardian);
        _grantRole(UNPAUSER_ROLE, unpauser);
        _grantRole(ATTESTATION_ADMIN_ROLE, attestationAdmin);
        _grantRole(
            LARGE_WITHDRAWAL_APPROVER_ROLE,
            largeWithdrawalApprover
        );

        signerSetVersion = 1;
        maxAuthorizationValiditySeconds = 30 minutes;
    }

    function reserve(
        WithdrawalAuthorization calldata authorization,
        bytes[] calldata signatures
    ) external whenNotPaused nonReentrant returns (bytes32 reservationId) {
        bytes32 digest = _validateAuthorization(authorization);
        reservationId = getReservationId(
            authorization.sourceChainId,
            authorization.sourceBridge,
            authorization.sourceWithdrawalId
        );

        if (reservations[reservationId].status != ReservationStatus.NONE) {
            revert InvalidReservationState();
        }

        _verifyAttestationSignatures(digest, signatures);

        TokenPolicy storage policy = tokenPolicies[authorization.token];
        _refreshWindow(policy);

        if (
            policy.windowLimit != 0 &&
            policy.releasedInWindow +
                totalReserved[authorization.token] +
                authorization.amount >
            policy.windowLimit
        ) {
            revert WindowLimitExceeded();
        }

        if (
            _assetBalance(authorization.token) <
            totalReserved[authorization.token] + authorization.amount
        ) {
            revert InsufficientLiquidity();
        }

        if (
            policy.manualReviewThreshold != 0 &&
            authorization.amount > policy.manualReviewThreshold
        ) {
            bytes32 reviewDigest = withdrawalReviewDigest(authorization);
            if (
                largeWithdrawalApprovalDeadline[reviewDigest] <
                authorization.deadline
            ) {
                revert LargeWithdrawalApprovalRequired();
            }
            delete largeWithdrawalApprovalDeadline[reviewDigest];
        }

        totalReserved[authorization.token] += authorization.amount;
        reservations[reservationId] = Reservation({
            status: ReservationStatus.RESERVED,
            token: authorization.token,
            recipient: authorization.recipient,
            amount: authorization.amount,
            deadline: authorization.deadline,
            authorizationDigest: digest
        });

        emit WithdrawalReserved(
            reservationId,
            digest,
            authorization.sourceWithdrawalId,
            authorization.token,
            authorization.recipient,
            authorization.amount,
            authorization.deadline
        );
    }

    function release(
        bytes32 reservationId
    ) external whenNotPaused nonReentrant {
        Reservation storage reservation = reservations[reservationId];
        if (reservation.status != ReservationStatus.RESERVED) {
            revert InvalidReservationState();
        }
        if (block.timestamp > reservation.deadline) {
            revert AuthorizationExpired();
        }

        TokenPolicy storage policy = tokenPolicies[reservation.token];
        if (!policy.enabled) revert TokenDisabled();
        _refreshWindow(policy);
        if (
            policy.windowLimit != 0 &&
            policy.releasedInWindow + reservation.amount > policy.windowLimit
        ) {
            revert WindowLimitExceeded();
        }

        reservation.status = ReservationStatus.RELEASED;
        totalReserved[reservation.token] -= reservation.amount;
        policy.releasedInWindow += reservation.amount;

        if (reservation.token == address(0)) {
            (bool success, ) = reservation.recipient.call{
                value: reservation.amount
            }("");
            if (!success) revert ETHTransferFailed();
        } else {
            IERC20(reservation.token).safeTransfer(
                reservation.recipient,
                reservation.amount
            );
        }

        emit WithdrawalReleased(
            reservationId,
            reservation.token,
            reservation.recipient,
            reservation.amount
        );
    }

    function cancelExpired(bytes32 reservationId) external {
        Reservation storage reservation = reservations[reservationId];
        if (reservation.status != ReservationStatus.RESERVED) {
            revert InvalidReservationState();
        }
        if (block.timestamp <= reservation.deadline) {
            revert ReservationNotExpired();
        }

        reservation.status = ReservationStatus.CANCELLED;
        totalReserved[reservation.token] -= reservation.amount;

        emit WithdrawalCancelled(reservationId);
    }

    function approveLargeWithdrawal(
        bytes32 digest,
        uint256 approvalDeadline
    ) external onlyRole(LARGE_WITHDRAWAL_APPROVER_ROLE) {
        if (
            digest == bytes32(0) ||
            approvalDeadline < block.timestamp
        ) {
            revert InvalidAuthorization();
        }
        largeWithdrawalApprovalDeadline[digest] = approvalDeadline;
        emit LargeWithdrawalApproved(digest, approvalDeadline);
    }

    function revokeLargeWithdrawalApproval(
        bytes32 digest
    ) external onlyRole(LARGE_WITHDRAWAL_APPROVER_ROLE) {
        delete largeWithdrawalApprovalDeadline[digest];
        emit LargeWithdrawalApprovalRevoked(digest);
    }

    function setTokenPolicy(
        address token,
        bool enabled,
        uint256 maxPerWithdrawal,
        uint256 windowLimit,
        uint256 windowSeconds,
        uint256 manualReviewThreshold
    ) external onlyRole(POLICY_ADMIN_ROLE) {
        if (windowLimit != 0 && windowSeconds == 0) {
            revert InvalidAuthorization();
        }

        TokenPolicy storage policy = tokenPolicies[token];
        if (policy.windowSeconds != windowSeconds) {
            policy.windowStartedAt = block.timestamp;
            policy.releasedInWindow = 0;
        }
        policy.enabled = enabled;
        policy.maxPerWithdrawal = maxPerWithdrawal;
        policy.windowLimit = windowLimit;
        policy.windowSeconds = windowSeconds;
        policy.manualReviewThreshold = manualReviewThreshold;

        emit TokenPolicyUpdated(
            token,
            enabled,
            maxPerWithdrawal,
            windowLimit,
            windowSeconds,
            manualReviewThreshold
        );
    }

    function setSourceBridge(
        uint256 sourceChainId,
        address sourceBridge,
        bool enabled
    ) external onlyRole(POLICY_ADMIN_ROLE) {
        if (sourceChainId == 0 || sourceBridge == address(0)) {
            revert InvalidAuthorization();
        }
        sourceBridges[sourceChainId][sourceBridge] = enabled;
        emit SourceBridgeUpdated(sourceChainId, sourceBridge, enabled);
    }

    function setAttestationSigner(
        address signer,
        bool enabled
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidAddress();
        bool currentlyEnabled = attestationSigners[signer];
        if (currentlyEnabled == enabled) return;

        if (enabled) {
            unchecked {
                ++attestationSignerCount;
            }
        } else {
            uint8 newSignerCount = attestationSignerCount - 1;
            if (attestationThreshold > newSignerCount) {
                revert InvalidAttestationThreshold();
            }
            attestationSignerCount = newSignerCount;
        }

        attestationSigners[signer] = enabled;
        ++signerSetVersion;
        emit AttestationSignerUpdated(signer, enabled, signerSetVersion);
    }

    function setAttestationThreshold(
        uint8 threshold
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (threshold == 0 || threshold > attestationSignerCount) {
            revert InvalidAttestationThreshold();
        }

        attestationThreshold = threshold;
        ++signerSetVersion;
        emit AttestationThresholdUpdated(threshold, signerSetVersion);
    }

    function setMaxAuthorizationValiditySeconds(
        uint256 validitySeconds
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (validitySeconds == 0) revert InvalidAuthorization();
        uint256 previousValiditySeconds = maxAuthorizationValiditySeconds;
        maxAuthorizationValiditySeconds = validitySeconds;
        emit MaxAuthorizationValidityUpdated(
            previousValiditySeconds,
            validitySeconds
        );
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }

    function authorizationDigest(
        WithdrawalAuthorization calldata authorization
    ) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        WITHDRAWAL_AUTHORIZATION_TYPEHASH,
                        authorization.sourceChainId,
                        authorization.sourceBridge,
                        authorization.sourceWithdrawalId,
                        authorization.destinationChainId,
                        authorization.destinationVault,
                        authorization.token,
                        authorization.recipient,
                        authorization.amount,
                        authorization.notBefore,
                        authorization.deadline,
                        authorization.signerSetVersion
                    )
                )
            );
    }

    function withdrawalReviewDigest(
        WithdrawalAuthorization calldata authorization
    ) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        WITHDRAWAL_REVIEW_TYPEHASH,
                        authorization.sourceChainId,
                        authorization.sourceBridge,
                        authorization.sourceWithdrawalId,
                        authorization.destinationChainId,
                        authorization.destinationVault,
                        authorization.token,
                        authorization.recipient,
                        authorization.amount
                    )
                )
            );
    }

    function getReservationId(
        uint256 sourceChainId,
        address sourceBridge,
        uint256 sourceWithdrawalId
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    sourceChainId,
                    sourceBridge,
                    sourceWithdrawalId
                )
            );
    }

    function availableLiquidity(address token) external view returns (uint256) {
        uint256 balance = _assetBalance(token);
        uint256 reserved = totalReserved[token];
        return balance > reserved ? balance - reserved : 0;
    }

    function _validateAuthorization(
        WithdrawalAuthorization calldata authorization
    ) internal view returns (bytes32 digest) {
        if (
            authorization.sourceChainId == 0 ||
            authorization.sourceBridge == address(0) ||
            authorization.sourceWithdrawalId == 0 ||
            authorization.destinationChainId != block.chainid ||
            authorization.destinationVault != address(this)
        ) {
            revert InvalidAuthorization();
        }
        if (authorization.recipient == address(0)) revert InvalidAddress();
        if (authorization.amount == 0) revert InvalidAmount();
        if (
            !sourceBridges[
                authorization.sourceChainId
            ][authorization.sourceBridge]
        ) {
            revert SourceBridgeDisabled();
        }
        if (authorization.notBefore > block.timestamp) {
            revert AuthorizationNotReady();
        }
        if (authorization.deadline < block.timestamp) {
            revert AuthorizationExpired();
        }
        if (authorization.deadline < authorization.notBefore) {
            revert InvalidAuthorization();
        }
        if (
            authorization.deadline >
            authorization.notBefore + maxAuthorizationValiditySeconds
        ) {
            revert AuthorizationValidityTooLong();
        }
        if (authorization.signerSetVersion != signerSetVersion) {
            revert StaleSignerSet();
        }

        TokenPolicy storage policy = tokenPolicies[authorization.token];
        if (!policy.enabled) revert TokenDisabled();
        if (
            policy.maxPerWithdrawal != 0 &&
            authorization.amount > policy.maxPerWithdrawal
        ) {
            revert PerWithdrawalLimitExceeded();
        }

        digest = authorizationDigest(authorization);
    }

    function _verifyAttestationSignatures(
        bytes32 digest,
        bytes[] calldata signatures
    ) internal view {
        uint8 threshold = attestationThreshold;
        if (threshold == 0 || signatures.length < threshold) {
            revert InvalidAttestationThreshold();
        }

        address previousSigner = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = digest.recover(signatures[i]);
            if (!attestationSigners[signer] || signer <= previousSigner) {
                revert BadAttestationSignatures();
            }
            previousSigner = signer;
        }
    }

    function _refreshWindow(TokenPolicy storage policy) internal {
        if (
            policy.windowSeconds != 0 &&
            block.timestamp >= policy.windowStartedAt + policy.windowSeconds
        ) {
            policy.windowStartedAt = block.timestamp;
            policy.releasedInWindow = 0;
        }
    }

    function _assetBalance(address token) internal view returns (uint256) {
        return
            token == address(0)
                ? address(this).balance
                : IERC20(token).balanceOf(address(this));
    }

    function _authorizeUpgrade(
        address
    ) internal override onlyRole(UPGRADER_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
