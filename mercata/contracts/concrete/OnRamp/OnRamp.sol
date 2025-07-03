import "./../abstract/ERC20/IERC20.sol";
import "../Lending/PriceOracle.sol";
import "../Admin/AdminRegistry.sol";
import "../Tokens/TokenFactory.sol";

contract record OnRamp is Ownable {
    event SellerApprovalUpdated(address seller, bool approved);
    event ListingCreated(uint256 listingId, address seller, address token, uint256 amount, uint256 margin);
    event ListingUpdated(uint256 listingId, uint256 newAmount, uint256 newMargin);
    event ListingCanceled(uint256 listingId);
    event ListingFulfilled(uint256 listingId, address buyer, uint256 amount, uint256 totalFiat);
    event PaymentProviderStatusUpdated(address provider, bool enabled);
    event AdminRegistryUpdated(address oldRegistry, address newRegistry);
    event TokenFactoryUpdated(address oldFactory, address newFactory);

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
    uint256 public listingIdCounter;
    mapping(address => bool) public record approvedSellers;
    mapping(address => PaymentProviderInfo) public record paymentProviders;
    TokenFactory public tokenFactory;
    AdminRegistry public adminRegistry;

    // Price oracle
    PriceOracle public priceOracle;
    // Listing management
    mapping(address => Listing) public record listings;

    // Constructor
    constructor(address _oracle, address _owner, address _tokenFactory, address _adminRegistry) Ownable(_owner) {
        require(_oracle != address(0), "Invalid oracle");
        require(_adminRegistry != address(0), "Invalid admin registry");
        require(_tokenFactory != address(0), "Invalid token factory");
        priceOracle = PriceOracle(_oracle);
        adminRegistry = AdminRegistry(_adminRegistry);
        tokenFactory = TokenFactory(_tokenFactory);
    }

    // Modifiers
    modifier onlyOwnerOrAdmin() {
        require(msg.sender == owner() || adminRegistry.isAdminAddress(msg.sender), "OnRamp: caller is not owner or admin");
        _;
    }
    modifier onlyApprovedSeller() {
        require(approvedSellers[msg.sender], "Not approved");
        _;
    }
    modifier onlyApprovedToken(address token) {
        require(tokenFactory.isTokenActive(token), "Token not active");
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

    function addPaymentProvider(address provider, string name, string endpoint) external onlyOwnerOrAdmin {
        require(!isPaymentProvider(provider), "Already exists");
        require(provider != address(0), "Invalid provider");

        paymentProviders[provider] = PaymentProviderInfo(
            provider,
            name,
            endpoint,
            true
        );

        emit PaymentProviderStatusUpdated(provider, true);
    }

    function removePaymentProvider(address provider) external onlyOwnerOrAdmin {
        require(paymentProviders[provider].exists, "Not a provider");

        delete paymentProviders[provider];
        emit PaymentProviderStatusUpdated(provider, false);
    }

    function setApprovedSeller(address seller, bool approved) external onlyOwnerOrAdmin {
        approvedSellers[seller] = approved;
        emit SellerApprovalUpdated(seller, approved);
    }

    function setPriceOracle(address newOracle) external onlyOwnerOrAdmin {
        priceOracle = PriceOracle(newOracle);
    }

    function setAdminRegistry(address newAdminRegistry) external onlyOwner {
        require(newAdminRegistry != address(0), "Invalid admin registry");
        address oldAdminRegistry = address(adminRegistry);
        adminRegistry = AdminRegistry(newAdminRegistry);
        emit AdminRegistryUpdated(oldAdminRegistry, newAdminRegistry);
    }

    function setTokenFactory(address _tokenFactory) external onlyOwnerOrAdmin {
        require(_tokenFactory != address(0), "Invalid token factory");
        address oldFactory = address(tokenFactory);
        tokenFactory = TokenFactory(_tokenFactory);
        emit TokenFactoryUpdated(oldFactory, _tokenFactory);
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

        emit ListingCanceled(listing.id);
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

    function rescueTokens(address token) external onlyOwnerOrAdmin {
        require(listings[token].seller != address(0), "No active listing for token");
        Listing listing = listings[token];
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to rescue");
        IERC20(token).transfer(listing.seller, balance);
    }

    function _validateProviders(address[] providerAddresses) internal view {
        mapping(address => bool) seen;

        for (uint i = 0; i < providerAddresses.length; i++) {
            address provider = providerAddresses[i];
            require(isPaymentProvider(provider), "Provider not allowed");
            require(!seen[provider], "Duplicate provider");
            seen[provider] = true;
        }
    }
}