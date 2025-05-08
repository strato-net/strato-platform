pragma es6;
pragma strict;

import <509>;

import "../ERC20/IERC20.sol";
import "../Lending/PriceOracleBase.sol";

abstract contract OnRamp {
    event TokenWhitelisted(address token);
    event SellerApproved(address seller, bool approved);
    event ListingCreated(uint256 listingId, address seller, address token, uint256 amount, uint256 margin);
    event ListingUpdated(uint256 listingId, uint256 newAmount, uint256 newMargin);
    event ListingCancelled(uint256 listingId);
    event ListingFulfilled(uint256 listingId, address buyer, uint256 amount, uint256 totalFiat);
    event AdminAdded(address admin);
    event AdminRemoved(address admin);
    event PaymentProviderAdded(address provider);
    event PaymentProviderRemoved(address provider);

    struct Listing {
        uint256 id;
        address token;
        address seller;
        uint256 amount;
        uint256 marginBps; // e.g. 500 = +5%
        bool closed;
    }

    struct Lock {
        uint256 amount;
        uint256 timestamp;
    }

    struct LockKey {
        uint256 listingId;
        address buyer;
    }

    struct PaymentProviderInfo {
        address providerAddress;
        string  name;
    }

    // Approval management
    uint256 public adminCount;
    mapping(address => bool) public admins;
    mapping(address => bool) public approvedSellers;
    mapping(address => bool) public approvedTokens;
    PaymentProviderInfo[] public paymentProviders;
    mapping(address => uint) public paymentProviderIndex;

    // Price oracle
    PriceOracleBase public priceOracle;

    // Listing management
    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public activeListingFor;
    mapping(uint256 => mapping(address => bool)) public listingProviders; // listingId => provider => bool

    // Lock management
    uint256 public LOCK_EXPIRY = 1800; // 30 minutes in seconds
    uint256 public MAX_LOCKS_PER_LISTING = 100;
    LockKey[] public activeLocks;
    mapping(uint256 => uint256) public lockCounts;
    mapping(uint256 => mapping(address => Lock)) public locks; // listingId => buyer => lock
    mapping(uint256 => mapping(address => uint256)) public lockIndex;

    // Constructor
    constructor(address _oracle, address _admin) {
        require(_admin != address(0), "Invalid admin");
        require(_oracle != address(0), "Invalid oracle");
        admins[_admin] = true;
        emit AdminAdded(_admin);
        adminCount = 1;
        priceOracle = PriceOracleBase(_oracle);
    }

    // Modifiers
    modifier onlyAdmin() {
        require(admins[msg.sender], "Not admin");
        _;
    }
    modifier onlyApprovedSeller() {
        require(approvedSellers[msg.sender], "Not approved");
        _;
    }
    modifier onlyApprovedToken(address token) {
        require(approvedTokens[token], "Token not allowed");
        _;
    }
    function isPaymentProvider(address provider) public view returns (bool) {
        return paymentProviderIndex[provider] != 0;
    }

    // Setter functions
    function setAdmin(address admin, bool enabled) external onlyAdmin {
        if (enabled) {
            require(!admins[admin], "Already admin");
            admins[admin] = true;
            emit AdminAdded(admin);
            adminCount++;
        } else {
            require(admins[admin], "Not admin");
            require(adminCount > 1, "Cannot remove last admin");
            admins[admin] = false;
            emit AdminRemoved(admin);
            adminCount--;
        }
    }

    function addPaymentProvider(address provider, string memory name) external onlyAdmin {
        require(paymentProviderIndex[provider] == 0, "Already payment provider");
        paymentProviders.push(PaymentProviderInfo(provider, name));
        paymentProviderIndex[provider] = paymentProviders.length; // 1-based indexing
        emit PaymentProviderAdded(provider);
    }

    function removePaymentProvider(address provider) external onlyAdmin {
        uint index = paymentProviderIndex[provider];
        require(index != 0, "Not payment provider");
        uint actualIndex = index - 1;
        uint lastIndex = paymentProviders.length - 1;

        if (actualIndex != lastIndex) {
            PaymentProviderInfo last = paymentProviders[lastIndex];
            paymentProviders[actualIndex] = last;
            paymentProviderIndex[last.providerAddress] = actualIndex + 1;
        }

        delete paymentProviders[lastIndex];
        paymentProviders.length = lastIndex;
        delete paymentProviderIndex[provider];

        emit PaymentProviderRemoved(provider);
    }

    function setApprovedToken(address token, bool whitelist) external onlyAdmin {
        if (whitelist) {
            require(!approvedTokens[token], "Already whitelisted");

            approvedTokens[token] = true;

            emit TokenWhitelisted(token);
        } else {
            require(approvedTokens[token], "Not whitelisted");
            approvedTokens[token] = false;
        }
    }

    function setApprovedSeller(address seller, bool approved) external onlyAdmin {
        approvedSellers[seller] = approved;
        emit SellerApproved(seller, approved);
    }

    function setLockExpiry(uint256 newExpiry) external onlyAdmin {
        LOCK_EXPIRY = newExpiry;
    }

    function setMaxLocksPerListing(uint256 newMax) external onlyAdmin {
        MAX_LOCKS_PER_LISTING = newMax;
    }

    function setPriceOracle(address newOracle) external onlyAdmin {
        priceOracle = PriceOracleBase(newOracle);
    }

    // Listing management functions
    function createListing(address token, uint256 amount, uint256 marginBps, address[] providerAddresses)
        external onlyApprovedSeller onlyApprovedToken(token)
    {
        require(amount > 0, "Zero amount");
        require(marginBps >= 0, "Margin less than 0");
        require(providerAddresses.length > 0, "No providers specified");

        uint256 existing = activeListingFor[token];
        require(existing == 0 || listings[existing].closed, "Active listing exists");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        listings[nextListingId] = Listing(
            nextListingId,
            token,
            msg.sender,
            amount,
            marginBps,
            false
        );

        activeListingFor[token] = nextListingId;
        emit ListingCreated(nextListingId, msg.sender, token, amount, marginBps);

        for (uint i = 0; i < providerAddresses.length; i++) {
            address provider = providerAddresses[i];
            require(isPaymentProvider(provider), "Provider not allowed");
            listingProviders[nextListingId][provider] = true;
        }

        nextListingId++;
    }

    function updateListing(uint256 listingId, uint256 amount, uint256 marginBps, address[] providerAddresses) external {
        Listing listing = listings[listingId];
        require(msg.sender == listing.seller, "Not seller");
        require(!listing.closed, "Closed");
        // Clear all providers via global list
        for (uint i = 0; i < paymentProviders.length; i++) {
            listingProviders[listingId][paymentProviders[i].providerAddress] = false;
        }
        require(providerAddresses.length > 0, "No providers specified");
        for (uint j = 0; j < providerAddresses.length; j++) {
            address p = providerAddresses[j];
            require(isPaymentProvider(p), "Provider not allowed");
            listingProviders[listingId][p] = true;
        }
        require(amount > 0, "Zero amount");
        require(marginBps >= 0, "Margin less than 0");

        if (amount > listing.amount) {
            uint256 delta = amount - listing.amount;
            require(IERC20(listing.token).balanceOf(msg.sender) >= delta, "Insufficient token balance to increase listing");
            IERC20(listing.token).transferFrom(msg.sender, address(this), delta);
        } else if (amount < listing.amount) {
            uint256 delta = listing.amount - amount;
            IERC20(listing.token).transfer(msg.sender, delta);
        }

        listing.amount = amount;
        listing.marginBps = marginBps;

        emit ListingUpdated(listingId, amount, marginBps);
    }

    function cancelListing(uint256 listingId) external {
        Listing listing = listings[listingId];
        require(msg.sender == listing.seller, "Not seller");
        require(!listing.closed, "Already closed");
        // Clear all providers via global list
        for (uint i = 0; i < paymentProviders.length; i++) {
            listingProviders[listingId][paymentProviders[i].providerAddress] = false;
        }

        uint256 remaining = listing.amount;
        listing.closed = true;
        activeListingFor[listing.token] = 0;
        listing.amount = 0;

        IERC20(listing.token).transfer(msg.sender, remaining);

        emit ListingCancelled(listingId);
    }

    function lockTokens(uint256 listingId, uint256 amount) external {
        sweepExpired();
        require(lockCounts[listingId] < MAX_LOCKS_PER_LISTING, "Too many locks");
        Listing listing = listings[listingId];
        require(!listing.closed, "Closed");
        require(amount > 0 && amount <= listing.amount, "Invalid amount");
        require(listing.amount >= amount, "Not enough available tokens");

        Lock l = locks[listingId][msg.sender];
        require(l.amount == 0, "Already locked");

        locks[listingId][msg.sender] = Lock(
            amount,
            block.timestamp
        );
        _addActiveLock(listingId, msg.sender);
        listing.amount -= amount;
    }

    function fulfillListing(uint256 listingId, address buyer) external {
        require(listingProviders[listingId][msg.sender], "Not allowed provider for this listing");
        uint256 lockedAmount = locks[listingId][buyer].amount;
        require(lockedAmount > 0, "No lock to fulfill");
        require(!listings[listingId].closed, "Closed");

        IERC20(listings[listingId].token).transfer(buyer, lockedAmount);

        uint256 totalFiat = calculatePrice(listings[listingId].token, lockedAmount, listings[listingId].marginBps);
        emit ListingFulfilled(listingId, buyer, lockedAmount, totalFiat);

        if (listings[listingId].amount == 0) {
            listings[listingId].closed = true;
            activeListingFor[listings[listingId].token] = 0;
        }

        locks[listingId][buyer] = Lock(0, 0);
        _removeActiveLock(listingId, buyer);
    }

    // Lock management helpers
    function _addActiveLock(uint256 listingId, address buyer) internal {
        activeLocks.push(LockKey(listingId, buyer));
        lockIndex[listingId][buyer] = activeLocks.length; // 1-based index
        lockCounts[listingId]++;
    }

    function _removeActiveLock(uint256 listingId, address buyer) internal {
        uint256 idx = lockIndex[listingId][buyer];
        require(idx > 0, "No active lock");
        uint256 lastIdx = activeLocks.length;
        uint256 lastListingId = activeLocks[lastIdx - 1].listingId;
        address lastBuyer = activeLocks[lastIdx - 1].buyer;
        activeLocks[idx - 1] = LockKey(lastListingId, lastBuyer);
        lockIndex[lastListingId][lastBuyer] = idx;
        uint len = activeLocks.length;
        activeLocks[len - 1] = LockKey(0, address(0));
        activeLocks.length = len - 1;
        lockIndex[listingId][buyer] = 0;
        lockCounts[listingId]--;
    }

    function sweepExpired() public {
        uint256 processed = 0;
        while (processed < MAX_LOCKS_PER_LISTING && activeLocks.length > 0) {
            uint256 idx = activeLocks.length - 1;
            uint256 listingId = activeLocks[idx].listingId;
            address buyer = activeLocks[idx].buyer;
            Lock l = locks[listingId][buyer];
            // Only expire if past expiry
            if (l.amount > 0 && block.timestamp > l.timestamp + LOCK_EXPIRY) {
                Listing listing = listings[listingId];
                listing.amount += l.amount;
                locks[listingId][buyer] = Lock(0, 0);
                _removeActiveLock(listingId, buyer);
                processed++;
            } else {
                break;
            }
        }
    }

    function calculatePrice(address token, uint256 amount, uint256 marginBps) public view returns (uint256) {
        uint256 base = priceOracle.getAssetPrice(token);
        uint256 finalPrice = base + (base * marginBps) / 10000;
        return finalPrice * amount;
    }

    function rescueTokens(address token) external onlyAdmin {
        uint256 listingId = activeListingFor[token];
        require(listingId != 0, "No active listing for token");
        Listing listing = listings[listingId];
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to rescue");
        IERC20(token).transfer(listing.seller, balance);
    }
}
