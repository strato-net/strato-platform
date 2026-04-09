import "../../abstract/ERC4626/ERC4626.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/Pausable.sol";

/// @title YieldVault
/// @notice ERC-4626 vault with:
///         - idle/deployed capital accounting
///         - instant withdraw/redeem when enough unreserved idle exists
///         - FIFO async redemption queue otherwise
///         - process-then-claim flow for robustness
///
/// Design goals for this version:
/// - ship a simple, defensible queue quickly
/// - avoid pro-rata settlement math
/// - avoid claim-time live queue pricing
/// - reserve processed claims so they cannot be redeployed or re-used
contract record YieldVault is ERC4626, Ownable, Pausable {
    struct WithdrawalRequest {
        uint256 shares;
        address receiver;
        uint64 next;
        bool exists;
    }

    uint256 public deployedAssets;
    uint256 public minIdleBps;
    bool public vaultInitialized;

    bool private locked;

    mapping(address => bool) public approvedStrategies;
    mapping(address => uint256) public strategyDebt;

    uint64 public nextRequestId = 1;
    uint64 public queueHead;
    uint64 public queueTail;
    uint256 public totalQueuedShares;

    mapping(uint64 => address) public requestOwner;
    mapping(uint64 => WithdrawalRequest) public requests;
    mapping(address => uint64) public activeRequestId;

    mapping(address => uint256) public claimableAssets;
    uint256 public totalClaimableAssets;

    event VaultInitialized(address indexed asset, string name, string symbol);
    event StrategyApprovalUpdated(address indexed strategy, bool approved);
    event MinIdleBpsUpdated(uint256 minIdleBps);
    event CapitalDeployed(address indexed strategy, uint256 assets, uint256 strategyDebt, uint256 totalDeployed);
    event CapitalReturned(
        address indexed strategy,
        uint256 assetsReturned,
        uint256 principalRepaid,
        uint256 realizedProfit,
        uint256 strategyDebt,
        uint256 totalDeployed
    );
    event StrategyLossReported(address indexed strategy, uint256 loss, uint256 strategyDebt, uint256 totalDeployed);
    event WithdrawalRequested(uint64 indexed requestId, address indexed owner, address indexed receiver, uint256 shares);
    event WithdrawalCanceled(uint64 indexed requestId, address indexed owner, uint256 shares);
    event WithdrawalPaidImmediately(address indexed owner, address indexed receiver, uint256 sharesBurned, uint256 assetsPaid);
    event QueueProcessed(
        uint64 indexed requestId,
        address indexed owner,
        uint256 sharesBurned,
        uint256 assetsReserved,
        bool fullyProcessed
    );
    event WithdrawalClaimed(address indexed owner, address indexed receiver, uint256 assets);

    constructor(address initialOwner)
        Ownable(initialOwner)
        ERC4626(address(0))
    {}

    modifier nonReentrant() {
        require(!locked, "YieldVault: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    function initialize(
        address asset_,
        string name_,
        string symbol_
    ) external onlyOwner {
        require(!vaultInitialized, "YieldVault: already initialized");
        require(asset_ != address(0), "YieldVault: asset=0");
        require(asset_ != address(this), "YieldVault: invalid asset");

        __ERC20_init(name_, symbol_);
        __ERC4626_init(asset_);
        vaultInitialized = true;
        minIdleBps = 0;
        nextRequestId = 1;

        emit VaultInitialized(asset_, name_, symbol_);
    }

    // ---------------------------------------------------------------------
    // ERC-4626 accounting
    // ---------------------------------------------------------------------

    function totalAssets() public view override returns (uint256) {
        if (!vaultInitialized) return 0;
        return _economicAssets();
    }

    function activeAssets() public view returns (uint256) {
        uint256 gross = totalAssets();
        if (gross <= totalClaimableAssets) return 0;
        return gross - totalClaimableAssets;
    }

    /// @notice Queued-but-unprocessed shares stay in the ERC-4626 pricing base.
    ///         Only processed claimable assets are carved out as reserved liabilities.
    function activeSupply() public view returns (uint256) {
        return totalSupply();
    }

    function _convertToShares(uint256 assets, bool roundUp) internal view override returns (uint256) {
        uint256 supply = activeSupply();
        uint256 assetsBase = activeAssets();
        if (assets == 0) return 0;
        if (supply == 0) return assets;
        if (assetsBase == 0) return 0;
        return _mulDiv(assets, supply, assetsBase, roundUp);
    }

    function _convertToAssets(uint256 shares, bool roundUp) internal view override returns (uint256) {
        uint256 supply = activeSupply();
        uint256 assetsBase = activeAssets();
        if (shares == 0) return 0;
        if (supply == 0) return shares;
        if (assetsBase == 0) return 0;
        return _mulDiv(shares, assetsBase, supply, roundUp);
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        return super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        return super.maxMint(receiver);
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        uint256 ownerAssets = _convertToAssets(balanceOf(owner_), false);
        uint256 freeIdle = _freeIdleForInstantWithdrawals();
        return ownerAssets < freeIdle ? ownerAssets : freeIdle;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        uint256 ownerShares = balanceOf(owner_);
        uint256 idleShares = _convertToShares(_freeIdleForInstantWithdrawals(), false);
        return ownerShares < idleShares ? ownerShares : idleShares;
    }

    // ---------------------------------------------------------------------
    // Standard ERC-4626 flow (instant only)
    // ---------------------------------------------------------------------

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        _requireInitialized();
        require(assets > 0, "YieldVault: zero assets");
        shares = previewDeposit(assets);
        require(shares > 0, "YieldVault: zero shares");
        _deposit(_msgSender(), receiver, assets, shares);
        return shares;
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        _requireInitialized();
        require(shares > 0, "YieldVault: zero shares");
        assets = previewMint(shares);
        require(assets > 0, "YieldVault: zero assets");
        _deposit(_msgSender(), receiver, assets, shares);
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        _requireInitialized();
        require(assets <= maxWithdraw(owner_), "ERC4626: withdraw exceeds max");
        shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner_, assets, shares);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        _requireInitialized();
        require(shares <= maxRedeem(owner_), "ERC4626: redeem exceeds max");
        assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner_, assets, shares);
        return assets;
    }

    // ---------------------------------------------------------------------
    // Async withdrawal flow
    // ---------------------------------------------------------------------

    function redeemOrQueue(uint256 shares, address receiver, address owner_)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 paidNow, uint64 requestId)
    {
        _requireInitialized();
        require(owner_ != address(0), "YieldVault: owner=0");
        require(receiver != address(0), "YieldVault: receiver=0");
        require(shares > 0, "YieldVault: zero shares");

        uint256 assets = previewRedeem(shares);
        require(assets > 0, "YieldVault: zero assets");

        if (_freeIdleForInstantWithdrawals() >= assets) {
            _withdraw(_msgSender(), receiver, owner_, assets, shares);
            emit WithdrawalPaidImmediately(owner_, receiver, shares, assets);
            return (assets, 0);
        }

        requestId = _requestRedeem(_msgSender(), shares, receiver, owner_);
        return (0, requestId);
    }

    function requestRedeem(uint256 shares, address receiver, address owner_)
        public
        whenNotPaused
        nonReentrant
        returns (uint64 requestId)
    {
        requestId = _requestRedeem(_msgSender(), shares, receiver, owner_);
        return requestId;
    }

    function cancelRequest() external nonReentrant {
        uint64 requestId = activeRequestId[_msgSender()];
        require(requestId != 0, "YieldVault: no active request");
        require(requestId == queueHead, "YieldVault: only head cancelable in v1");

        WithdrawalRequest storage r = requests[requestId];
        require(r.exists, "YieldVault: bad request");
        require(r.shares > 0, "YieldVault: already processed");

        uint256 shares = r.shares;
        uint64 next = r.next;

        totalQueuedShares -= shares;
        activeRequestId[_msgSender()] = 0;

        delete requests[requestId];
        delete requestOwner[requestId];
        if (next == 0) {
            delete queueHead;
            queueTail = 0;
        } else {
            queueHead = next;
        }

        _transfer(address(this), _msgSender(), shares);
        emit WithdrawalCanceled(requestId, _msgSender(), shares);
    }

    function processQueue(uint256 maxRequests, uint256 maxAssets)
        external
        onlyOwner
        whenNotPaused
        nonReentrant
        returns (uint256 processedRequests, uint256 burnedShares, uint256 reservedAssets)
    {
        _requireInitialized();
        require(maxRequests > 0, "YieldVault: zero maxRequests");

        uint256 assetsRemaining = _freeIdleForQueueProcessing();
        if (maxAssets < assetsRemaining) {
            assetsRemaining = maxAssets;
        }

        uint64 current = queueHead;
        while (current != 0 && processedRequests < maxRequests && assetsRemaining > 0) {
            address owner_ = requestOwner[current];
            WithdrawalRequest storage r = requests[current];

            uint256 pendingShares = r.shares;
            if (pendingShares == 0) {
                current = _popProcessedHead(current, owner_);
                continue;
            }

            uint256 pendingAssets = previewRedeem(pendingShares);
            if (pendingAssets <= assetsRemaining) {
                r.shares = 0;
                totalQueuedShares -= pendingShares;
                burnedShares += pendingShares;
                reservedAssets += pendingAssets;
                claimableAssets[owner_] += pendingAssets;
                totalClaimableAssets += pendingAssets;
                assetsRemaining -= pendingAssets;

                _burn(address(this), pendingShares);
                emit QueueProcessed(current, owner_, pendingShares, pendingAssets, true);

                current = _popProcessedHead(current, owner_);
                processedRequests++;
            } else {
                uint256 sharesProcessable = previewWithdraw(assetsRemaining);
                if (sharesProcessable == 0) break;
                if (sharesProcessable > pendingShares) {
                    sharesProcessable = pendingShares;
                }

                uint256 assetsReservedNow = previewRedeem(sharesProcessable);
                if (assetsReservedNow == 0 || assetsReservedNow > assetsRemaining) break;

                r.shares = pendingShares - sharesProcessable;
                totalQueuedShares -= sharesProcessable;
                burnedShares += sharesProcessable;
                reservedAssets += assetsReservedNow;
                claimableAssets[owner_] += assetsReservedNow;
                totalClaimableAssets += assetsReservedNow;
                assetsRemaining -= assetsReservedNow;

                _burn(address(this), sharesProcessable);
                emit QueueProcessed(current, owner_, sharesProcessable, assetsReservedNow, false);
                processedRequests++;
                break;
            }
        }

        return (processedRequests, burnedShares, reservedAssets);
    }

    function claim(address receiver) external nonReentrant returns (uint256 assets) {
        _requireInitialized();
        require(receiver != address(0), "YieldVault: receiver=0");

        assets = claimableAssets[_msgSender()];
        require(assets > 0, "YieldVault: nothing claimable");

        claimableAssets[_msgSender()] = 0;
        totalClaimableAssets -= assets;
        require(IERC20(asset()).transfer(receiver, assets), "YieldVault: claim transfer failed");

        emit WithdrawalClaimed(_msgSender(), receiver, assets);
        return assets;
    }

    function _popProcessedHead(uint64 current, address owner_) internal returns (uint64 next) {
        WithdrawalRequest storage r = requests[current];
        next = r.next;
        activeRequestId[owner_] = 0;
        delete requestOwner[current];
        delete requests[current];
        queueHead = next;
        if (next == 0) {
            queueTail = 0;
        }
        return next;
    }

    function _requestRedeem(address caller, uint256 shares, address receiver, address owner_)
        internal
        returns (uint64 requestId)
    {
        _requireInitialized();
        require(owner_ != address(0), "YieldVault: owner=0");
        require(receiver != address(0), "YieldVault: receiver=0");
        require(shares > 0, "YieldVault: zero shares");
        require(balanceOf(owner_) >= shares, "YieldVault: insufficient shares");
        require(activeRequestId[owner_] == 0, "YieldVault: active request exists");

        if (caller != owner_) {
            _spendAllowance(owner_, caller, shares);
        }

        requestId = nextRequestId++;
        requestOwner[requestId] = owner_;
        requests[requestId] = WithdrawalRequest({
            shares: shares,
            receiver: receiver,
            next: 0,
            exists: true
        });

        activeRequestId[owner_] = requestId;
        totalQueuedShares += shares;
        _transfer(owner_, address(this), shares);

        if (queueTail == 0) {
            queueHead = requestId;
            queueTail = requestId;
        } else {
            requests[queueTail].next = requestId;
            queueTail = requestId;
        }

        emit WithdrawalRequested(requestId, owner_, receiver, shares);
        return requestId;
    }

    // ---------------------------------------------------------------------
    // Capital management
    // ---------------------------------------------------------------------

    function setStrategyApproval(address strategy, bool approved) external onlyOwner {
        _requireInitialized();
        require(strategy != address(0), "YieldVault: strategy=0");
        approvedStrategies[strategy] = approved;
        emit StrategyApprovalUpdated(strategy, approved);
    }

    function setMinIdleBps(uint256 minIdleBps_) external onlyOwner {
        _requireInitialized();
        require(minIdleBps_ <= 10000, "YieldVault: idle bps too high");
        minIdleBps = minIdleBps_;
        emit MinIdleBpsUpdated(minIdleBps_);
    }

    function deployCapital(address to, uint256 assets) external onlyOwner whenNotPaused nonReentrant {
        _requireInitialized();
        require(to != address(0), "YieldVault: to=0");
        require(approvedStrategies[to], "YieldVault: strategy not approved");
        require(assets > 0, "YieldVault: zero deploy");
        require(assets <= maxDeploy(), "YieldVault: deploy exceeds max");

        strategyDebt[to] += assets;
        deployedAssets += assets;
        require(IERC20(asset()).transfer(to, assets), "YieldVault: deploy failed");

        emit CapitalDeployed(to, assets, strategyDebt[to], deployedAssets);
    }

    function returnCapital(address from, uint256 assets) external onlyOwner nonReentrant {
        _requireInitialized();
        require(from != address(0), "YieldVault: from=0");
        require(assets > 0, "YieldVault: zero return");
        require(strategyDebt[from] > 0, "YieldVault: no strategy debt");

        require(IERC20(asset()).transferFrom(from, address(this), assets), "YieldVault: return failed");

        uint256 principalRepaid = assets > strategyDebt[from] ? strategyDebt[from] : assets;
        uint256 realizedProfit = assets - principalRepaid;

        strategyDebt[from] -= principalRepaid;
        deployedAssets -= principalRepaid;

        emit CapitalReturned(from, assets, principalRepaid, realizedProfit, strategyDebt[from], deployedAssets);
    }

    function reportStrategyLoss(address strategy, uint256 loss) external onlyOwner whenNotPaused {
        _requireInitialized();
        require(strategy != address(0), "YieldVault: strategy=0");
        require(loss > 0, "YieldVault: zero loss");
        require(loss <= strategyDebt[strategy], "YieldVault: loss exceeds debt");

        strategyDebt[strategy] -= loss;
        deployedAssets -= loss;
        emit StrategyLossReported(strategy, loss, strategyDebt[strategy], deployedAssets);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views / helpers
    // ---------------------------------------------------------------------

    function idleAssets() external view returns (uint256) {
        return _idleBalance();
    }

    function freeIdleForInstantWithdrawals() external view returns (uint256) {
        return _freeIdleForInstantWithdrawals();
    }

    function freeIdleForQueueProcessing() external view returns (uint256) {
        return _freeIdleForQueueProcessing();
    }

    function exchangeRate() external view returns (uint256) {
        uint256 supply = activeSupply();
        if (supply == 0) return 1e18;
        return (activeAssets() * 1e18) / supply;
    }

    function maxDeploy() public view returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        if (queueHead != 0) return 0;

        uint256 freeIdle = _freeIdleForQueueProcessing();
        uint256 minIdleRequirement = _minIdleRequirement();
        if (freeIdle <= minIdleRequirement) return 0;
        return freeIdle - minIdleRequirement;
    }

    function _requireInitialized() internal view {
        require(vaultInitialized, "YieldVault: not initialized");
    }

    function _economicAssets() internal view returns (uint256) {
        return _idleBalance() + deployedAssets;
    }

    function _idleBalance() internal view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function _freeIdleForInstantWithdrawals() internal view returns (uint256) {
        if (queueHead != 0) return 0;
        uint256 idle = _idleBalance();
        if (idle <= totalClaimableAssets) return 0;
        return idle - totalClaimableAssets;
    }

    function _freeIdleForQueueProcessing() internal view returns (uint256) {
        uint256 idle = _idleBalance();
        if (idle <= totalClaimableAssets) return 0;
        return idle - totalClaimableAssets;
    }

    function _minIdleRequirement() internal view returns (uint256) {
        if (minIdleBps == 0) return 0;
        return _mulDiv(activeAssets(), minIdleBps, 10000, true);
    }
}
