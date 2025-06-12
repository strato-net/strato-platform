import "./../abstract/ERC20/IERC20.sol";
import "../Lending/PriceOracle.sol";

contract record OnRamp {
    event TokenWhitelisted(address token, bool whitelist);
    event SellerApproved(address seller, bool approved);
    event ListingCreated(uint256 listingId, address seller, address token, uint256 amount, uint256 margin);
    event ListingUpdated(uint256 listingId, uint256 newAmount, uint256 newMargin);
    event ListingCancelled(uint256 listingId);
    event ListingFulfilled(uint256 listingId, address buyer, uint256 amount, uint256 totalFiat);
    event AdminAdded(address admin, bool enabled);
    event PaymentProviderAdded(address provider, bool enabled);

    struct Listing {
        uint256 id;
        address token;
        address seller;
        uint256 amount;
        uint256 marginBps; // e.g. 500 = +5%
        address[] providers;
    }

    struct PaymentProviderInfo {
        address providerAddress;
        string  name;
        string  endpoint;
        bool    exists;
    }

    // Approval management
    uint256 public adminCount;
    uint256 public listingIdCounter;
    mapping(address => bool) public record admins;
    mapping(address => bool) public record approvedSellers;
    mapping(address => bool) public record approvedTokens;
    mapping(address => PaymentProviderInfo) public record paymentProviders;

    // Price oracle
    PriceOracle public priceOracle;

    // Listing management
    mapping(address => Listing) public record listings;

    // Constructor
    constructor(address _oracle, address _admin) {
        require(_admin != address(0), "Invalid admin");
        require(_oracle != address(0), "Invalid oracle");
        admins[_admin] = true;
        emit AdminAdded(_admin, true);
        adminCount = 1;
        priceOracle = PriceOracle(_oracle);
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

    modifier onlyProvider(address token) {
        require(listings[token].seller != address(0), "Closed");

        bool found = false;
        address[] providers = listings[token].providers;
        for (uint i = 0; i < providers.length; i++) {
            if (providers[i] == msg.sender) {
                found = true;
                break;
            }
        }
        require(found, "Not a provider");
        _;
    }
    
    function isPaymentProvider(address provider) public view returns (bool) {
        return paymentProviders[provider].exists;
    }

    function isProviderForListing(address token, address provider) public view returns (bool) {
        address[] providers = listings[token].providers;
        for (uint i = 0; i < providers.length; i++) {
            if (providers[i] == provider) {
                return true;
            }
        }
        return false;
    }

    function setAdmin(address admin, bool enabled) external onlyAdmin {
        if (enabled) {
            require(!admins[admin], "Already admin");
            admins[admin] = true;
            emit AdminAdded(admin, true);
            adminCount++;
        } else {
            require(admins[admin], "Not admin");
            require(adminCount > 1, "Cannot remove last admin");
            delete admins[admin];
            emit AdminAdded(admin, false);
            adminCount--;
        }
    }

    function addPaymentProvider(address provider, string name, string endpoint) external onlyAdmin {
        require(!isPaymentProvider(provider), "Already exists");
        require(provider != address(0), "Invalid provider");

        paymentProviders[provider] = PaymentProviderInfo(
            provider,
            name,
            endpoint,
            true
        );

        emit PaymentProviderAdded(provider, true);
    }

    function removePaymentProvider(address provider) external onlyAdmin {
        require(paymentProviders[provider].exists, "Not a provider");

        delete paymentProviders[provider];
        emit PaymentProviderAdded(provider, false);
    }

    function setApprovedToken(address token, bool whitelist) external onlyAdmin {
        approvedTokens[token] = whitelist;
        emit TokenWhitelisted(token, whitelist);
    }

    function setApprovedSeller(address seller, bool approved) external onlyAdmin {
        approvedSellers[seller] = approved;
        emit SellerApproved(seller, approved);
    }

    function setPriceOracle(address newOracle) external onlyAdmin {
        priceOracle = PriceOracle(newOracle);
    }

    // Listing management functions
    function createListing(address token, uint256 amount, uint256 marginBps, address[] providerAddresses)
        external onlyApprovedSeller onlyApprovedToken(token)
    {
        require(amount > 0, "Zero amount");
        require(marginBps >= 0, "Margin less than 0");
        require(providerAddresses.length > 0, "No providers specified");

        require(listings[token].seller == address(0), "Active listing exists");

        _validateProviders(providerAddresses);

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        listingIdCounter++;
        uint256 listingId = listingIdCounter;

        listings[token] = Listing(
            listingId,
            token,
            msg.sender,
            amount,
            marginBps,
            providerAddresses
        );

        emit ListingCreated(listingId, msg.sender, token, amount, marginBps);
    }

    function updateListing(address token, uint256 amount, uint256 marginBps, address[] providerAddresses) external {
        require(listings[token].seller != address(0), "Closed");
        require(msg.sender == listings[token].seller, "Not seller");
        require(providerAddresses.length > 0, "No providers specified");
        require(amount > 0, "Zero amount");
        require(marginBps >= 0, "Margin less than 0");

        _validateProviders(providerAddresses);

        Listing listing = listings[token];

        // Handle token amount changes
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
        listing.providers = providerAddresses;

        emit ListingUpdated(listing.id, amount, marginBps);
    }

    function cancelListing(address token) external {
        require(listings[token].seller != address(0), "Already closed");
        require(msg.sender == listings[token].seller, "Not seller");

        Listing listing = listings[token];
        uint256 remaining = listing.amount;
        IERC20(listing.token).transfer(msg.sender, remaining);
        
        delete listings[token];

        emit ListingCancelled(listing.id);
    }

    function fulfillListing(address token, address buyer, uint256 amount) external onlyProvider(token) {
        require(amount > 0, "Invalid amount");
        require(listings[token].amount >= amount, "Not enough available tokens");

        IERC20(listings[token].token).transfer(buyer, amount);
        listings[token].amount -= amount;

        uint256 totalFiat = calculatePrice(listings[token].token, amount, listings[token].marginBps);
        emit ListingFulfilled(listings[token].id, buyer, amount, totalFiat);

        if (listings[token].amount == 0) {
            delete listings[token];
        }
    }

    function calculatePrice(address token, uint256 amount, uint256 marginBps) public view returns (uint256) {
        uint256 base = priceOracle.getAssetPrice(token);
        uint256 finalPrice = base + (base * marginBps) / 10000;
        return finalPrice * amount;
    }

    function rescueTokens(address token) external onlyAdmin {
        require(listings[token].seller != address(0), "No active listing for token");
        Listing listing = listings[token];
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to rescue");
        IERC20(token).transfer(listing.seller, balance);
    }

    function _validateProviders(address[] providerAddresses) internal view {
        for (uint i = 0; i < providerAddresses.length; i++) {
            require(isPaymentProvider(providerAddresses[i]), "Provider not allowed");
            for (uint j = i + 1; j < providerAddresses.length; j++) {
                require(providerAddresses[i] != providerAddresses[j], "Duplicate provider");
            }
        }
    }
}