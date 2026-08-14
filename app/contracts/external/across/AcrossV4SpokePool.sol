// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.30;

// Kept local so this source can be deployed through STRATO's source-based
// contract endpoint without relying on filesystem import resolution.
interface AcrossV4IERC20 {
    function balanceOf(address account) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);
    function approve(address spender, uint value) external returns (bool);
    function transfer(address to, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);
}

interface AcrossV4MercataBridge {
    function requestWithdrawal(
        uint externalChainId,
        address externalRecipient,
        address externalToken,
        address stratoToken,
        uint stratoTokenAmount
    ) external returns (uint);
}

interface AcrossV4MessageHandler {
    function handleV3AcrossMessage(address tokenSent, uint amount, address relayer, bytes message) external;
}

interface AcrossV4SignatureValidator {
    function isValidSignature(bytes32 digest, bytes signature) external view returns (bytes4);
}

/// @title Across V4 SpokePool core for SolidVM
/// @notice SolidVM-native implementation of the permissionless v4 deposit and
/// fast-fill path. Structs, function arguments, relay hashing, and events track
/// Across contracts v4.1.28. Ethereum-root administration is layered on by the
/// Universal spoke adapter rather than weakening these public entrypoints.
contract AcrossV4SpokePool {
    enum FillStatus {
        Unfilled,
        RequestedSlowFill,
        Filled
    }

    enum FillType {
        FastFill,
        ReplacedSlowFill,
        SlowFill
    }

    struct V3RelayData {
        bytes32 depositor;
        bytes32 recipient;
        bytes32 exclusiveRelayer;
        bytes32 inputToken;
        bytes32 outputToken;
        uint inputAmount;
        uint outputAmount;
        uint originChainId;
        uint depositId;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
        bytes message;
    }

    struct V3RelayDataLegacy {
        address depositor;
        address recipient;
        address exclusiveRelayer;
        address inputToken;
        address outputToken;
        uint inputAmount;
        uint outputAmount;
        uint originChainId;
        uint32 depositId;
        uint32 fillDeadline;
        uint32 exclusivityDeadline;
        bytes message;
    }

    struct V3RelayExecutionEventInfo {
        bytes32 updatedRecipient;
        bytes32 updatedMessageHash;
        uint updatedOutputAmount;
        FillType fillType;
    }

    struct V3SlowFill {
        V3RelayData relayData;
        uint chainId;
        uint updatedOutputAmount;
    }

    struct RelayerRefundLeaf {
        uint amountToReturn;
        uint chainId;
        uint[] refundAmounts;
        uint32 leafId;
        address l2TokenAddress;
        address[] refundAddresses;
    }

    uint32 public numberOfDeposits;
    bool public pausedDeposits;
    bool public pausedFills;
    address public admin;
    address public crossDomainAdmin;
    address public withdrawalRecipient;
    uint32 public depositQuoteTimeBuffer;
    uint32 public fillDeadlineBuffer;
    mapping(bytes32 => uint) public fillStatuses;
    bytes32[] public relayerRefundRoots;
    bytes32[] public slowRelayRoots;
    mapping(uint => mapping(uint => uint)) internal claimedRefundBitmap;
    mapping(address => mapping(address => uint)) public relayerRefund;
    mapping(address => address) public tokenReturnBridges;
    mapping(address => uint) public tokenReturnChainIds;
    mapping(address => address) public tokenReturnExternalTokens;
    mapping(uint32 => mapping(uint32 => uint)) public tokenReturnWithdrawalIds;
    bool internal entered;

    uint32 public constant MAX_EXCLUSIVITY_PERIOD_SECONDS = 31536000;
    bytes32 public constant UPDATE_BYTES32_DEPOSIT_DETAILS_HASH = bytes32(
        0x8d1994e2bbbd77564cdca06dd819e7ee2a5efa06c80dcb59a4a7b6e39edc538f
    );
    bytes32 constant EIP712_DOMAIN_TYPE_HASH = bytes32(
        0xc2f8787176b8ac6bf7215b4adcc1e069bf4ab82d9ab1df05a57a91d425935b6e
    );
    bytes32 constant ACROSS_V2_NAME_HASH = bytes32(
        0xec4e9f157c7c27788e0dfbb20798d3f8c8066985256c4d077bdccf4022c0eb66
    );
    bytes32 constant ACROSS_V2_VERSION_HASH = bytes32(
        0x06c015bd22b4c69690933c1058878ebdfef31f9aaae40bbe86d8a09fe1b2972c
    );
    uint constant SECP256K1_HALF_N =
        57896044618658097711785492504343953926418782139537452191302581570759080747168;
    bytes4 constant EIP1271_MAGIC_VALUE = bytes4(0x1626ba7e);

    event FundsDeposited(
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint indexed destinationChainId,
        uint indexed depositId,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes32 indexed depositor,
        bytes32 recipient,
        bytes32 exclusiveRelayer,
        bytes message
    );

    event FilledRelay(
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint repaymentChainId,
        uint indexed originChainId,
        uint indexed depositId,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes32 exclusiveRelayer,
        bytes32 indexed relayer,
        bytes32 depositor,
        bytes32 recipient,
        bytes32 messageHash,
        V3RelayExecutionEventInfo relayExecutionInfo
    );

    event RequestedSlowFill(
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint indexed originChainId,
        uint indexed depositId,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes32 exclusiveRelayer,
        bytes32 depositor,
        bytes32 recipient,
        bytes32 messageHash
    );

    event RequestedSpeedUpDeposit(
        uint updatedOutputAmount,
        uint indexed depositId,
        bytes32 indexed depositor,
        bytes32 updatedRecipient,
        bytes updatedMessage,
        bytes depositorSignature
    );

    event ClaimedRelayerRefund(
        bytes32 indexed l2TokenAddress,
        bytes32 indexed refundAddress,
        uint amount,
        address indexed caller
    );

    event PausedDeposits(bool isPaused);
    event PausedFills(bool isPaused);
    event SetXDomainAdmin(address indexed newAdmin);
    event SetWithdrawalRecipient(address indexed newWithdrawalRecipient);
    event RelayedRootBundle(
        uint32 indexed rootBundleId,
        bytes32 indexed relayerRefundRoot,
        bytes32 indexed slowRelayRoot
    );
    event ExecutedRelayerRefundRoot(
        uint amountToReturn,
        uint indexed chainId,
        uint[] refundAmounts,
        uint32 indexed rootBundleId,
        uint32 indexed leafId,
        address l2TokenAddress,
        address[] refundAddresses,
        bool deferredRefunds,
        address caller
    );
    event TokensBridged(
        uint amountToReturn,
        uint indexed chainId,
        uint32 indexed leafId,
        bytes32 indexed l2TokenAddress,
        address caller
    );
    event TokenReturnRouteSet(
        address indexed l2TokenAddress,
        address indexed bridge,
        uint externalChainId,
        address indexed externalToken
    );
    event TokenReturnWithdrawalQueued(
        uint32 indexed rootBundleId,
        uint32 indexed leafId,
        uint indexed withdrawalId,
        address bridge
    );
    event EmergencyDeletedRootBundle(uint indexed rootBundleId);

    modifier onlyAdmin() {
        _requireAdminSender();
        _;
    }

    modifier nonReentrant() {
        require(!entered, "Across reentrancy");
        entered = true;
        _;
        entered = false;
    }

    constructor(address initialAdmin, uint32 quoteTimeBuffer, uint32 deadlineBuffer, uint32 initialDepositId) {
        require(initialAdmin != address(0), "Across admin is zero");
        admin = initialAdmin;
        crossDomainAdmin = initialAdmin;
        withdrawalRecipient = initialAdmin;
        depositQuoteTimeBuffer = quoteTimeBuffer;
        fillDeadlineBuffer = deadlineBuffer;
        numberOfDeposits = initialDepositId;
    }

    function chainId() public view returns (uint) {
        return block.chainid;
    }

    function getCurrentTime() public view returns (uint) {
        return block.timestamp;
    }

    function addressToBytes32(address account) public pure returns (bytes32) {
        return bytes32(uint(account));
    }

    function bytes32ToAddress(bytes32 value) public pure returns (address) {
        require(uint(value) <= ((1 << 160) - 1), "Across bytes32 is not an EVM address");
        return address(uint(value));
    }

    function pauseDeposits(bool pause) public onlyAdmin {
        pausedDeposits = pause;
        emit PausedDeposits(pause);
    }

    function pauseFills(bool pause) public onlyAdmin {
        pausedFills = pause;
        emit PausedFills(pause);
    }

    function setCrossDomainAdmin(address newCrossDomainAdmin) public onlyAdmin nonReentrant {
        require(newCrossDomainAdmin != address(0), "Across cross-domain admin is zero");
        crossDomainAdmin = newCrossDomainAdmin;
        admin = newCrossDomainAdmin;
        emit SetXDomainAdmin(newCrossDomainAdmin);
    }

    function setWithdrawalRecipient(address newWithdrawalRecipient) public onlyAdmin nonReentrant {
        require(newWithdrawalRecipient != address(0), "Across withdrawal recipient is zero");
        withdrawalRecipient = newWithdrawalRecipient;
        emit SetWithdrawalRecipient(newWithdrawalRecipient);
    }

    /// @notice Configures the existing MercataBridge route used to return a
    /// SpokePool token to Ethereum. Universal spokes can only invoke this via
    /// an Ethereum-proved HubPoolStore message. Passing three zero route
    /// values removes a route and restores fail-closed behavior.
    function setTokenReturnRoute(
        address l2TokenAddress,
        address bridge,
        uint externalChainId,
        address externalToken
    ) public onlyAdmin nonReentrant {
        require(l2TokenAddress != address(0), "Across return token is zero");
        if (bridge == address(0)) {
            require(
                externalChainId == 0 && externalToken == address(0),
                "Across partial return route"
            );
        } else {
            require(externalChainId != 0, "Across return chain is zero");
            require(externalToken != address(0), "Across external token is zero");
        }
        tokenReturnBridges[l2TokenAddress] = bridge;
        tokenReturnChainIds[l2TokenAddress] = externalChainId;
        tokenReturnExternalTokens[l2TokenAddress] = externalToken;
        emit TokenReturnRouteSet(l2TokenAddress, bridge, externalChainId, externalToken);
    }

    function _requireAdminSender() internal view virtual {
        require(msg.sender == admin, "Across admin only");
    }

    function relayRootBundle(bytes32 relayerRefundRoot, bytes32 slowRelayRoot)
        public onlyAdmin nonReentrant
    {
        uint32 rootBundleId = uint32(relayerRefundRoots.length);
        relayerRefundRoots.push(relayerRefundRoot);
        slowRelayRoots.push(slowRelayRoot);
        emit RelayedRootBundle(rootBundleId, relayerRefundRoot, slowRelayRoot);
    }

    function emergencyDeleteRootBundle(uint rootBundleId) public onlyAdmin nonReentrant {
        require(rootBundleId < relayerRefundRoots.length, "Across root bundle missing");
        relayerRefundRoots[rootBundleId] = bytes32(0);
        slowRelayRoots[rootBundleId] = bytes32(0);
        emit EmergencyDeletedRootBundle(rootBundleId);
    }

    function rootBundleCount() public view returns (uint) {
        return relayerRefundRoots.length;
    }

    function depositV3(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        address exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityParameter,
        bytes memory message
    ) public nonReentrant {
        _deposit(
            addressToBytes32(depositor),
            addressToBytes32(recipient),
            addressToBytes32(inputToken),
            addressToBytes32(outputToken),
            inputAmount,
            outputAmount,
            destinationChainId,
            addressToBytes32(exclusiveRelayer),
            quoteTimestamp,
            fillDeadline,
            exclusivityParameter,
            message
        );
    }

    function depositV3Now(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        address exclusiveRelayer,
        uint32 fillDeadlineOffset,
        uint32 exclusivityParameter,
        bytes memory message
    ) public {
        uint32 currentTime = uint32(getCurrentTime());
        depositV3(
            depositor,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            exclusiveRelayer,
            currentTime,
            currentTime + fillDeadlineOffset,
            exclusivityParameter,
            message
        );
    }

    function deposit(
        bytes32 depositor,
        bytes32 recipient,
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        bytes32 exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityParameter,
        bytes memory message
    ) public nonReentrant {
        _deposit(
            depositor,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            exclusiveRelayer,
            quoteTimestamp,
            fillDeadline,
            exclusivityParameter,
            message
        );
    }

    function depositNow(
        bytes32 depositor,
        bytes32 recipient,
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        bytes32 exclusiveRelayer,
        uint32 fillDeadlineOffset,
        uint32 exclusivityParameter,
        bytes memory message
    ) public {
        uint32 currentTime = uint32(getCurrentTime());
        deposit(
            depositor,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            exclusiveRelayer,
            currentTime,
            currentTime + fillDeadlineOffset,
            exclusivityParameter,
            message
        );
    }

    function getUnsafeDepositId(address msgSender, bytes32 depositor, uint depositNonce)
        public pure returns (uint)
    {
        bytes memory paddedSender = bytes(bytes32(uint(msgSender)));
        bytes memory senderBytes = new bytes(20);
        for (uint i = 0; i < 20; i++) {
            senderBytes[i] = paddedSender[i + 12];
        }
        return uint(keccak256(senderBytes + bytes(depositor) + bytes(bytes32(depositNonce))));
    }

    function unsafeDeposit(
        bytes32 depositor,
        bytes32 recipient,
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        bytes32 exclusiveRelayer,
        uint depositNonce,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityParameter,
        bytes memory message
    ) public nonReentrant {
        _depositWithId(
            depositor,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            exclusiveRelayer,
            getUnsafeDepositId(msg.sender, depositor, depositNonce),
            quoteTimestamp,
            fillDeadline,
            exclusivityParameter,
            message
        );
    }

    function _deposit(
        bytes32 depositor,
        bytes32 recipient,
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        bytes32 exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityParameter,
        bytes memory message
    ) internal {
        uint depositId = numberOfDeposits;
        numberOfDeposits++;
        _depositWithId(
            depositor,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            exclusiveRelayer,
            depositId,
            quoteTimestamp,
            fillDeadline,
            exclusivityParameter,
            message
        );
    }

    function _depositWithId(
        bytes32 depositor,
        bytes32 recipient,
        bytes32 inputToken,
        bytes32 outputToken,
        uint inputAmount,
        uint outputAmount,
        uint destinationChainId,
        bytes32 exclusiveRelayer,
        uint depositId,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityParameter,
        bytes memory message
    ) internal {
        require(!pausedDeposits, "Across deposits paused");
        bytes32ToAddress(depositor);
        address inputTokenAddress = bytes32ToAddress(inputToken);
        require(bytes32ToAddress(outputToken) != address(0), "Across output token is zero");

        uint currentTime = getCurrentTime();
        require(currentTime >= quoteTimestamp, "Across quote is in the future");
        require(currentTime - quoteTimestamp <= depositQuoteTimeBuffer, "Across quote is stale");
        require(fillDeadline <= currentTime + fillDeadlineBuffer, "Across fill deadline too far away");

        uint32 exclusivityDeadline = exclusivityParameter;
        if (exclusivityDeadline > 0) {
            if (exclusivityDeadline <= MAX_EXCLUSIVITY_PERIOD_SECONDS) {
                exclusivityDeadline += uint32(currentTime);
            }
            require(exclusiveRelayer != bytes32(0), "Across exclusive relayer is zero");
        }

        require(AcrossV4IERC20(inputTokenAddress).transferFrom(msg.sender, address(this), inputAmount), "Across deposit transfer failed");

        emit FundsDeposited(
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            depositId,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            depositor,
            recipient,
            exclusiveRelayer,
            message
        );
    }

    function toRelayData(V3RelayDataLegacy memory relayData) internal pure returns (V3RelayData memory) {
        return V3RelayData({
            depositor: addressToBytes32(relayData.depositor),
            recipient: addressToBytes32(relayData.recipient),
            exclusiveRelayer: addressToBytes32(relayData.exclusiveRelayer),
            inputToken: addressToBytes32(relayData.inputToken),
            outputToken: addressToBytes32(relayData.outputToken),
            inputAmount: relayData.inputAmount,
            outputAmount: relayData.outputAmount,
            originChainId: relayData.originChainId,
            depositId: relayData.depositId,
            fillDeadline: relayData.fillDeadline,
            exclusivityDeadline: relayData.exclusivityDeadline,
            message: relayData.message
        });
    }

    function getV3RelayHash(V3RelayData memory relayData) public view returns (bytes32) {
        return computeV3RelayHash(relayData, chainId());
    }

    function computeV3RelayHash(V3RelayData memory relayData, uint destinationChainId)
        public pure returns (bytes32)
    {
        // SolidVM's generic abi.encode currently flattens dynamic structs
        // differently from Solidity. Across relayers require the canonical
        // Solidity encoding exactly, so assemble the two-head-word outer tuple
        // and the twelve-head-word relay tuple explicitly.
        uint paddedMessageLength = ((relayData.message.length + 31) / 32) * 32;
        bytes memory paddedMessage = new bytes(paddedMessageLength);
        for (uint i = 0; i < relayData.message.length; i++) {
            paddedMessage[i] = relayData.message[i];
        }

        bytes memory encoded =
            bytes(bytes32(64)) +
            bytes(bytes32(destinationChainId)) +
            bytes(relayData.depositor) +
            bytes(relayData.recipient) +
            bytes(relayData.exclusiveRelayer) +
            bytes(relayData.inputToken) +
            bytes(relayData.outputToken) +
            bytes(bytes32(relayData.inputAmount)) +
            bytes(bytes32(relayData.outputAmount)) +
            bytes(bytes32(relayData.originChainId)) +
            bytes(bytes32(relayData.depositId)) +
            bytes(bytes32(uint(relayData.fillDeadline))) +
            bytes(bytes32(uint(relayData.exclusivityDeadline))) +
            bytes(bytes32(384)) +
            bytes(bytes32(relayData.message.length)) +
            paddedMessage;

        return keccak256(encoded);
    }

    function getV3RelayHashLegacy(V3RelayDataLegacy memory relayData) public view returns (bytes32) {
        return getV3RelayHash(toRelayData(relayData));
    }

    /// @notice Canonical keccak256(abi.encode(V3SlowFill)).
    function hashV3SlowFill(V3SlowFill memory slowFill) public pure returns (bytes32) {
        V3RelayData memory relayData = slowFill.relayData;
        uint paddedMessageLength = ((relayData.message.length + 31) / 32) * 32;
        bytes memory paddedMessage = new bytes(paddedMessageLength);
        for (uint i = 0; i < relayData.message.length; i++) {
            paddedMessage[i] = relayData.message[i];
        }

        bytes memory encoded =
            bytes(bytes32(32)) +
            bytes(bytes32(96)) +
            bytes(bytes32(slowFill.chainId)) +
            bytes(bytes32(slowFill.updatedOutputAmount)) +
            bytes(relayData.depositor) +
            bytes(relayData.recipient) +
            bytes(relayData.exclusiveRelayer) +
            bytes(relayData.inputToken) +
            bytes(relayData.outputToken) +
            bytes(bytes32(relayData.inputAmount)) +
            bytes(bytes32(relayData.outputAmount)) +
            bytes(bytes32(relayData.originChainId)) +
            bytes(bytes32(relayData.depositId)) +
            bytes(bytes32(uint(relayData.fillDeadline))) +
            bytes(bytes32(uint(relayData.exclusivityDeadline))) +
            bytes(bytes32(384)) +
            bytes(bytes32(relayData.message.length)) +
            paddedMessage;
        return keccak256(encoded);
    }

    function getUpdateDepositTypedDataHash(
        uint depositId,
        uint originChainId,
        uint updatedOutputAmount,
        bytes32 updatedRecipient,
        bytes memory updatedMessage
    ) public pure returns (bytes32) {
        bytes32 structHash = keccak256(
            bytes(UPDATE_BYTES32_DEPOSIT_DETAILS_HASH) +
            bytes(bytes32(depositId)) +
            bytes(bytes32(originChainId)) +
            bytes(bytes32(updatedOutputAmount)) +
            bytes(updatedRecipient) +
            bytes(keccak256(updatedMessage))
        );
        bytes32 domainSeparator = keccak256(
            bytes(EIP712_DOMAIN_TYPE_HASH) +
            bytes(ACROSS_V2_NAME_HASH) +
            bytes(ACROSS_V2_VERSION_HASH) +
            bytes(bytes32(originChainId))
        );
        return keccak256(bytes(hex"1901") + bytes(domainSeparator) + bytes(structHash));
    }

    function readSignatureWord(bytes memory signature, uint offset) internal pure returns (uint result) {
        require(offset + 32 <= signature.length, "Across signature word out of bounds");
        for (uint i = 0; i < 32; i++) {
            result = (result << 8) | signature[offset + i];
        }
    }

    function recoverUpdateDepositSigner(bytes32 digest, bytes memory signature)
        public pure returns (address)
    {
        require(signature.length == 65, "Across signature must be 65 bytes");
        uint r = readSignatureWord(signature, 0);
        uint s = readSignatureWord(signature, 32);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Across signature v is invalid");
        require(s > 0 && s <= SECP256K1_HALF_N, "Across signature s is invalid");
        return ecrecover(digest, v, r, s);
    }

    function _verifyUpdateDepositSignature(
        address depositor,
        uint depositId,
        uint originChainId,
        uint updatedOutputAmount,
        bytes32 updatedRecipient,
        bytes memory updatedMessage,
        bytes memory depositorSignature
    ) internal view {
        bytes32 digest = getUpdateDepositTypedDataHash(
            depositId,
            originChainId,
            updatedOutputAmount,
            updatedRecipient,
            updatedMessage
        );

        if (depositorSignature.length == 65) {
            uint r = readSignatureWord(depositorSignature, 0);
            uint s = readSignatureWord(depositorSignature, 32);
            uint8 v = uint8(depositorSignature[64]);
            if (v < 27) v += 27;
            if ((v == 27 || v == 28) && s > 0 && s <= SECP256K1_HALF_N) {
                address signer = ecrecover(digest, v, r, s);
                if (signer == depositor) return;
            }
        }

        try AcrossV4SignatureValidator(depositor).isValidSignature(digest, depositorSignature)
            returns (bytes4 magicValue)
        {
            require(magicValue == EIP1271_MAGIC_VALUE, "Across invalid depositor signature");
            return;
        } catch {
            revert("Across invalid depositor signature");
        }
    }

    function speedUpDeposit(
        bytes32 depositor,
        uint depositId,
        uint updatedOutputAmount,
        bytes32 updatedRecipient,
        bytes memory updatedMessage,
        bytes memory depositorSignature
    ) public nonReentrant {
        address depositorAddress = bytes32ToAddress(depositor);
        bytes32ToAddress(updatedRecipient);
        _verifyUpdateDepositSignature(
            depositorAddress,
            depositId,
            chainId(),
            updatedOutputAmount,
            updatedRecipient,
            updatedMessage,
            depositorSignature
        );
        emit RequestedSpeedUpDeposit(
            updatedOutputAmount,
            depositId,
            depositor,
            updatedRecipient,
            updatedMessage,
            depositorSignature
        );
    }

    function speedUpV3Deposit(
        address depositor,
        uint depositId,
        uint updatedOutputAmount,
        address updatedRecipient,
        bytes memory updatedMessage,
        bytes memory depositorSignature
    ) public nonReentrant {
        _verifyUpdateDepositSignature(
            depositor,
            depositId,
            chainId(),
            updatedOutputAmount,
            addressToBytes32(updatedRecipient),
            updatedMessage,
            depositorSignature
        );
        emit RequestedSpeedUpDeposit(
            updatedOutputAmount,
            depositId,
            addressToBytes32(depositor),
            addressToBytes32(updatedRecipient),
            updatedMessage,
            depositorSignature
        );
    }

    function getFillStatusLegacy(V3RelayDataLegacy memory relayData) public view returns (uint) {
        return fillStatuses[getV3RelayHash(toRelayData(relayData))];
    }

    function getFillStatus(V3RelayData memory relayData) public view returns (uint) {
        return fillStatuses[getV3RelayHash(relayData)];
    }

    function fillV3Relay(V3RelayDataLegacy memory relayData, uint repaymentChainId) public nonReentrant {
        V3RelayData memory converted = toRelayData(relayData);
        _requireExclusiveFiller(converted);
        _fillRelay(
            converted,
            repaymentChainId,
            addressToBytes32(msg.sender),
            converted.outputAmount,
            converted.recipient,
            converted.message,
            false
        );
    }

    function fillRelay(V3RelayData memory relayData, uint repaymentChainId, bytes32 repaymentAddress)
        public nonReentrant
    {
        _requireExclusiveFiller(relayData);
        _fillRelay(
            relayData,
            repaymentChainId,
            repaymentAddress,
            relayData.outputAmount,
            relayData.recipient,
            relayData.message,
            false
        );
    }

    function fillRelayWithUpdatedDeposit(
        V3RelayData memory relayData,
        uint repaymentChainId,
        bytes32 repaymentAddress,
        uint updatedOutputAmount,
        bytes32 updatedRecipient,
        bytes memory updatedMessage,
        bytes memory depositorSignature
    ) public nonReentrant {
        require(!pausedFills, "Across fills paused");
        _requireExclusiveFiller(relayData);
        address depositor = bytes32ToAddress(relayData.depositor);
        bytes32ToAddress(updatedRecipient);
        _verifyUpdateDepositSignature(
            depositor,
            relayData.depositId,
            relayData.originChainId,
            updatedOutputAmount,
            updatedRecipient,
            updatedMessage,
            depositorSignature
        );
        _fillRelay(
            relayData,
            repaymentChainId,
            repaymentAddress,
            updatedOutputAmount,
            updatedRecipient,
            updatedMessage,
            false
        );
    }

    function _requireExclusiveFiller(V3RelayData memory relayData) internal view {
        uint currentTime = getCurrentTime();
        if (relayData.exclusivityDeadline > 0 && relayData.exclusivityDeadline >= currentTime) {
            require(bytes32ToAddress(relayData.exclusiveRelayer) == msg.sender, "Across exclusive relayer only");
        }
    }

    function _fillRelay(
        V3RelayData memory relayData,
        uint repaymentChainId,
        bytes32 relayer,
        uint updatedOutputAmount,
        bytes32 updatedRecipient,
        bytes memory updatedMessage,
        bool isSlowFill
    ) internal {
        if (!isSlowFill) require(!pausedFills, "Across fills paused");
        uint currentTime = getCurrentTime();
        require(relayData.fillDeadline >= currentTime, "Across fill expired");

        bytes32 relayHash = getV3RelayHash(relayData);
        require(fillStatuses[relayHash] != uint(FillStatus.Filled), "Across relay already filled");
        FillType fillType;
        if (isSlowFill) {
            fillType = FillType.SlowFill;
        } else if (fillStatuses[relayHash] == uint(FillStatus.RequestedSlowFill)) {
            fillType = FillType.ReplacedSlowFill;
        } else {
            fillType = FillType.FastFill;
        }
        fillStatuses[relayHash] = uint(FillStatus.Filled);

        bytes32 messageHash = relayData.message.length == 0 ? bytes32(0) : keccak256(relayData.message);
        bytes32 updatedMessageHash = updatedMessage.length == 0 ? bytes32(0) : keccak256(updatedMessage);
        V3RelayExecutionEventInfo memory eventInfo = V3RelayExecutionEventInfo({
            updatedRecipient: updatedRecipient,
            updatedMessageHash: updatedMessageHash,
            updatedOutputAmount: updatedOutputAmount,
            fillType: fillType
        });

        emit FilledRelay(
            relayData.inputToken,
            relayData.outputToken,
            relayData.inputAmount,
            relayData.outputAmount,
            repaymentChainId,
            relayData.originChainId,
            relayData.depositId,
            relayData.fillDeadline,
            relayData.exclusivityDeadline,
            relayData.exclusiveRelayer,
            relayer,
            relayData.depositor,
            relayData.recipient,
            messageHash,
            eventInfo
        );

        address outputToken = bytes32ToAddress(relayData.outputToken);
        address recipient = bytes32ToAddress(updatedRecipient);
        if (isSlowFill) {
            require(AcrossV4IERC20(outputToken).transfer(recipient, updatedOutputAmount), "Across slow fill transfer failed");
        } else {
            require(
                AcrossV4IERC20(outputToken).transferFrom(msg.sender, recipient, updatedOutputAmount),
                "Across fill transfer failed"
            );
        }

        if (updatedMessage.length > 0) {
            AcrossV4MessageHandler(recipient).handleV3AcrossMessage(
                outputToken,
                updatedOutputAmount,
                msg.sender,
                updatedMessage
            );
        }
    }

    function requestSlowFill(V3RelayData memory relayData) public nonReentrant {
        require(!pausedFills, "Across fills paused");
        uint currentTime = getCurrentTime();
        require(relayData.exclusivityDeadline < currentTime, "Across slow fill is exclusive");
        require(relayData.fillDeadline >= currentTime, "Across slow fill expired");

        bytes32 relayHash = getV3RelayHash(relayData);
        require(fillStatuses[relayHash] == uint(FillStatus.Unfilled), "Across slow fill status invalid");
        fillStatuses[relayHash] = uint(FillStatus.RequestedSlowFill);
        bytes32 messageHash = relayData.message.length == 0 ? bytes32(0) : keccak256(relayData.message);

        emit RequestedSlowFill(
            relayData.inputToken,
            relayData.outputToken,
            relayData.inputAmount,
            relayData.outputAmount,
            relayData.originChainId,
            relayData.depositId,
            relayData.fillDeadline,
            relayData.exclusivityDeadline,
            relayData.exclusiveRelayer,
            relayData.depositor,
            relayData.recipient,
            messageHash
        );
    }

    function executeSlowRelayLeaf(
        V3SlowFill memory slowFillLeaf,
        uint32 rootBundleId,
        bytes32[] memory proof
    ) public nonReentrant {
        V3RelayData memory relayData = slowFillLeaf.relayData;
        require(rootBundleId < slowRelayRoots.length, "Across root bundle missing");
        require(slowFillLeaf.chainId == chainId(), "Across slow fill is for another chain");
        require(
            verifyMerkleProof(slowRelayRoots[rootBundleId], hashV3SlowFill(slowFillLeaf), proof),
            "Across invalid slow-fill proof"
        );
        _fillRelay(
            relayData,
            0,
            bytes32(0),
            slowFillLeaf.updatedOutputAmount,
            relayData.recipient,
            relayData.message,
            true
        );
    }

    /// @notice Canonical keccak256(abi.encode(RelayerRefundLeaf)).
    /// SolidVM's generic dynamic-struct encoder is not Solidity-compatible,
    /// so the tuple offsets and array bodies are assembled explicitly.
    function hashRelayerRefundLeaf(RelayerRefundLeaf memory leaf) public pure returns (bytes32) {
        require(
            leaf.refundAmounts.length == leaf.refundAddresses.length,
            "Across refund arrays differ in length"
        );
        uint addressArrayOffset = 224 + leaf.refundAmounts.length * 32;
        bytes memory encoded =
            bytes(bytes32(32)) +
            bytes(bytes32(leaf.amountToReturn)) +
            bytes(bytes32(leaf.chainId)) +
            bytes(bytes32(192)) +
            bytes(bytes32(uint(leaf.leafId))) +
            bytes(bytes32(uint(leaf.l2TokenAddress))) +
            bytes(bytes32(addressArrayOffset)) +
            bytes(bytes32(leaf.refundAmounts.length));

        for (uint i = 0; i < leaf.refundAmounts.length; i++) {
            encoded = encoded + bytes(bytes32(leaf.refundAmounts[i]));
        }
        encoded = encoded + bytes(bytes32(leaf.refundAddresses.length));
        for (uint i = 0; i < leaf.refundAddresses.length; i++) {
            encoded = encoded + bytes(bytes32(uint(leaf.refundAddresses[i])));
        }
        return keccak256(encoded);
    }

    function verifyMerkleProof(bytes32 root, bytes32 leaf, bytes32[] memory proof)
        public pure returns (bool)
    {
        bytes32 computed = leaf;
        for (uint i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            if (uint(computed) <= uint(sibling)) {
                computed = keccak256(bytes(computed) + bytes(sibling));
            } else {
                computed = keccak256(bytes(sibling) + bytes(computed));
            }
        }
        return computed == root;
    }

    function isRefundLeafClaimed(uint32 rootBundleId, uint32 leafId) public view returns (bool) {
        uint word = claimedRefundBitmap[rootBundleId][uint(leafId) / 256];
        uint mask = 1 << (uint(leafId) % 256);
        return word & mask == mask;
    }

    function getRelayerRefund(address l2TokenAddress, address refundAddress) public view returns (uint) {
        return relayerRefund[l2TokenAddress][refundAddress];
    }

    function _tryTransfer(address token, address recipient, uint amount) internal returns (bool) {
        try AcrossV4IERC20(token).transfer(recipient, amount) returns (bool transferred) {
            return transferred;
        } catch {
            return false;
        }
    }

    function executeRelayerRefundLeaf(
        uint32 rootBundleId,
        RelayerRefundLeaf memory leaf,
        bytes32[] memory proof
    ) public nonReentrant {
        require(leaf.chainId == chainId(), "Across refund is for another chain");
        require(rootBundleId < relayerRefundRoots.length, "Across root bundle missing");
        require(
            verifyMerkleProof(relayerRefundRoots[rootBundleId], hashRelayerRefundLeaf(leaf), proof),
            "Across invalid refund proof"
        );
        require(!isRefundLeafClaimed(rootBundleId, leaf.leafId), "Across refund leaf already claimed");
        require(
            leaf.refundAmounts.length == leaf.refundAddresses.length,
            "Across refund arrays differ in length"
        );
        uint totalRefundAmount = 0;
        for (uint i = 0; i < leaf.refundAmounts.length; i++) {
            totalRefundAmount += leaf.refundAmounts[i];
        }
        require(
            AcrossV4IERC20(leaf.l2TokenAddress).balanceOf(address(this))
                >= totalRefundAmount + leaf.amountToReturn,
            "Across refund balance too low"
        );

        uint wordIndex = uint(leaf.leafId) / 256;
        claimedRefundBitmap[rootBundleId][wordIndex] =
            claimedRefundBitmap[rootBundleId][wordIndex] | (1 << (uint(leaf.leafId) % 256));

        bool deferredRefunds = false;
        for (uint i = 0; i < leaf.refundAmounts.length; i++) {
            if (leaf.refundAmounts[i] > 0) {
                if (!_tryTransfer(leaf.l2TokenAddress, leaf.refundAddresses[i], leaf.refundAmounts[i])) {
                    relayerRefund[leaf.l2TokenAddress][leaf.refundAddresses[i]] += leaf.refundAmounts[i];
                    deferredRefunds = true;
                }
            }
        }

        if (leaf.amountToReturn > 0) {
            uint withdrawalId = _bridgeTokensToHubPool(
                leaf.amountToReturn,
                leaf.l2TokenAddress
            );
            tokenReturnWithdrawalIds[rootBundleId][leaf.leafId] = withdrawalId;
            emit TokensBridged(
                leaf.amountToReturn,
                leaf.chainId,
                leaf.leafId,
                bytes32(uint(leaf.l2TokenAddress)),
                msg.sender
            );
            emit TokenReturnWithdrawalQueued(
                rootBundleId,
                leaf.leafId,
                withdrawalId,
                tokenReturnBridges[leaf.l2TokenAddress]
            );
        }

        emit ExecutedRelayerRefundRoot(
            leaf.amountToReturn,
            leaf.chainId,
            leaf.refundAmounts,
            rootBundleId,
            leaf.leafId,
            leaf.l2TokenAddress,
            leaf.refundAddresses,
            deferredRefunds,
            msg.sender
        );
    }

    function _bridgeTokensToHubPool(uint amountToReturn, address l2TokenAddress)
        internal returns (uint withdrawalId)
    {
        address bridge = tokenReturnBridges[l2TokenAddress];
        uint externalChainId = tokenReturnChainIds[l2TokenAddress];
        address externalToken = tokenReturnExternalTokens[l2TokenAddress];
        require(bridge != address(0), "Across token return bridge not configured");
        require(externalChainId != 0, "Across token return chain not configured");
        require(externalToken != address(0), "Across external return token not configured");

        AcrossV4IERC20 token = AcrossV4IERC20(l2TokenAddress);
        uint spokeBalanceBefore = token.balanceOf(address(this));
        uint bridgeBalanceBefore = token.balanceOf(bridge);
        require(spokeBalanceBefore >= amountToReturn, "Across return balance too low");

        // Exact, single-use approval avoids leaving bridge authority over the
        // SpokePool's inventory. Zero-first also supports USDT-style tokens.
        require(token.approve(bridge, 0), "Across return approval reset failed");
        require(token.approve(bridge, amountToReturn), "Across return approval failed");
        withdrawalId = AcrossV4MercataBridge(bridge).requestWithdrawal(
            externalChainId,
            withdrawalRecipient,
            externalToken,
            l2TokenAddress,
            amountToReturn
        );
        require(withdrawalId != 0, "Across return withdrawal ID is zero");
        require(token.approve(bridge, 0), "Across return approval cleanup failed");

        require(
            spokeBalanceBefore - token.balanceOf(address(this)) == amountToReturn,
            "Across return amount was not exact"
        );
        require(
            token.balanceOf(bridge) - bridgeBalanceBefore == amountToReturn,
            "Across bridge did not escrow exact amount"
        );
        require(token.allowance(address(this), bridge) == 0, "Across return allowance remains");
    }

    function claimRelayerRefund(bytes32 l2TokenAddress, bytes32 refundAddress) public nonReentrant {
        address token = bytes32ToAddress(l2TokenAddress);
        address recipient = bytes32ToAddress(refundAddress);
        uint refund = relayerRefund[token][msg.sender];
        require(refund > 0, "Across no relayer refund to claim");
        relayerRefund[token][msg.sender] = 0;
        require(AcrossV4IERC20(token).transfer(recipient, refund), "Across refund claim transfer failed");
        emit ClaimedRelayerRefund(l2TokenAddress, refundAddress, refund, msg.sender);
    }
}
