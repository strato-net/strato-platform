/**
 * @title FixedPriceSaleFactory
 * @notice Factory contract that standardizes FixedPriceSale creation and tracking.
 *         Mirrors the VaultFactory / TokenFactory pattern: owner-only creation, registry
 *         by name, proxy-pattern implementation that can be refreshed on demand.
 *
 * Operator runbook (per design — sale tokens are pre-minted and transferred in by ops):
 *   1. Owner calls `createSale(...)` — factory deploys a Proxy → fresh FixedPriceSale impl
 *      and initializes it with the sale parameters.
 *   2. Owner transfers the sale-token allocation into the new sale address.
 *   3. Owner calls `addPaymentToken(...)` on the sale for each accepted stablecoin.
 *   4. Sale opens at `startTime`.
 */

import "FixedPriceSale.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Proxy/Proxy.sol";

contract record FixedPriceSaleFactory is Ownable {

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    event NewSale(string name, address indexed sale, address indexed saleToken);
    event SalesMigrated(address oldFactory, address newFactory, uint saleCount);
    event PriceOracleUpdated(address indexed newOracle);

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════════

    /// @notice Mapping of sale name → sale address
    mapping(string => address) public record salesByName;

    /// @notice All sale addresses ever created or registered with this factory
    address[] public record allSales;

    /// @notice Default PriceOracle used to initialize new sales
    address public priceOracle;

    /// @notice Current FixedPriceSale implementation, refreshed on each createSale call
    address public saleImplementation;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Initialize the factory.
     * @param _priceOracle Default PriceOracle address propagated to new sales
     */
    function initialize(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "Zero price oracle address");
        priceOracle = _priceOracle;
        emit PriceOracleUpdated(_priceOracle);
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "Zero price oracle address");
        priceOracle = _priceOracle;
        emit PriceOracleUpdated(_priceOracle);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // SALE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create and initialize a new FixedPriceSale.
     * @param name Unique registry name for the sale
     * @param saleToken Token being sold (e.g. STRATO)
     * @param pricePerTokenUSD Sale price in USD per sale token (18 decimals)
     * @param hardCap Max total sale tokens that can be sold (18 decimals)
     * @param perWalletCap Max sale tokens per wallet (18 decimals); 0 disables the cap
     * @param startTime UNIX seconds when the sale opens
     * @param endTime UNIX seconds when the sale closes
     * @return sale Address of the newly created sale
     */
    function createSale(
        string name,
        address saleToken,
        uint pricePerTokenUSD,
        uint hardCap,
        uint perWalletCap,
        uint startTime,
        uint endTime
    ) external onlyOwner returns (address sale) {
        require(salesByName[name] == address(0), "Sale name exists");
        require(priceOracle != address(0), "Factory not initialized");

        _updateSaleImplementation();

        sale = address(new Proxy(saleImplementation, address(this)));

        FixedPriceSale(sale).initialize(
            saleToken,
            priceOracle,
            pricePerTokenUSD,
            hardCap,
            perWalletCap,
            startTime,
            endTime
        );

        // Hand ownership to the factory owner so they can add payment tokens, sweep, etc.
        address thisOwner = owner();
        FixedPriceSale(sale).transferOwnership(thisOwner);

        salesByName[name] = sale;
        allSales.push(sale);

        emit NewSale(name, sale, saleToken);
        return sale;
    }

    /// @notice Look up a sale by name. Returns address(0) if not registered.
    function getSale(string name) external view returns (address) {
        return salesByName[name];
    }

    function getSaleCount() external view returns (uint) {
        return allSales.length;
    }

    function getAllSales() external view returns (address[] memory) {
        return allSales;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // MIGRATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register sales from another factory into this one. Does not transfer ownership.
     */
    function registerSalesFromFactory(address[] saleAddresses, string[] saleNames) external onlyOwner {
        require(saleAddresses.length == saleNames.length, "Array length mismatch");

        for (uint i = 0; i < saleAddresses.length; i++) {
            address s = saleAddresses[i];
            string memory n = saleNames[i];
            if (salesByName[n] == address(0)) {
                salesByName[n] = s;
                allSales.push(s);
            }
        }

        emit SalesMigrated(address(0), address(this), saleAddresses.length);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // IMPLEMENTATION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    function updateSaleImplementation() external onlyOwner {
        _updateSaleImplementation();
    }

    function _updateSaleImplementation() internal {
        address thisOwner = owner();
        saleImplementation = address(new FixedPriceSale(thisOwner));
    }
}
