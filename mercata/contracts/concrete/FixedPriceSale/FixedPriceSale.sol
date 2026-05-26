import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/utils/Pausable.sol";
import "../Lending/PriceOracle.sol";

/**
 * @title FixedPriceSale
 * @notice Sells a fixed allocation of a token at a fixed USD price, accepting one or more
 *         stablecoin / oracle-priced payment tokens. Sale tokens are pre-minted and transferred
 *         into the contract by the owner before the sale opens; proceeds are held by the sale
 *         until the owner sweeps them.
 *
 * Math conventions (mirror Vault.sol):
 *   - All amounts are in 18-decimal base units (WAD = 1e18)
 *   - `pricePerTokenUSD` is denominated in USD with 18 decimals (1e18 = $1.00, 5e17 = $0.50)
 *   - `priceOracle.getAssetPrice(paymentToken)` returns USD per token in 18-decimal form
 *   - paymentAmount = (saleAmount * pricePerTokenUSD) / oraclePrice
 *
 * Guards:
 *   - Hard cap on total sale tokens sold
 *   - Per-wallet cap on sale tokens purchased
 *   - Start/end timestamps (UNIX seconds, matching `block.timestamp`)
 *   - Pausable + reentrancy-guarded
 */
contract record FixedPriceSale is Ownable, Pausable {

    // ═══════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    event Initialized(
        address saleToken,
        address priceOracle,
        uint pricePerTokenUSD,
        uint hardCap,
        uint perWalletCap,
        uint startTime,
        uint endTime
    );
    event Purchased(
        address indexed buyer,
        address indexed paymentToken,
        uint saleAmount,
        uint paymentAmount,
        uint usdValue
    );
    event PaymentTokenAdded(address indexed paymentToken);
    event PaymentTokenRemoved(address indexed paymentToken);
    event PriceUpdated(uint newPricePerTokenUSD);
    event HardCapUpdated(uint newHardCap);
    event PerWalletCapUpdated(uint newPerWalletCap);
    event ScheduleUpdated(uint newStartTime, uint newEndTime);
    event PriceOracleUpdated(address indexed newPriceOracle);
    event PriceQuantizationUpdated(uint newPriceQuantizationUSD);
    event ProceedsSwept(address indexed paymentToken, address indexed to, uint amount);
    event UnsoldSwept(address indexed to, uint amount);

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════════

    uint public WAD;

    // The token being sold (e.g. STRATO). Pre-minted and transferred in by admin.
    address public saleToken;

    // Sale price in USD per sale token (18 decimals). e.g. 5e17 = $0.50
    uint public pricePerTokenUSD;

    // Hard cap on total sale tokens that can be sold (sale-token base units, 18 decimals).
    uint public hardCap;

    // Per-wallet cap on sale tokens purchased (sale-token base units). 0 = no per-wallet cap.
    uint public perWalletCap;

    // UNIX timestamp (seconds) — sale opens at startTime and closes at endTime (exclusive).
    uint public startTime;
    uint public endTime;

    // Total sale tokens sold so far.
    uint public totalSold;

    // Oracle used to price payment tokens in USD (1e18 = $1).
    PriceOracle public priceOracle;

    // Granularity for rounding the oracle's payment-token price before computing payment amount.
    // 1e16 = $0.01. Buyers always pay an amount derived from a half-up-rounded price, so a
    // payment token reading $0.999 charges as if it were $1.00 instead of 1.001 tokens per $1.
    uint public priceQuantizationUSD;

    // Supported payment tokens
    address[] public record supportedPayments;
    mapping(address => bool) public record isSupportedPayment;

    // Per-buyer accounting
    mapping(address => uint) public record purchased;

    // Initialized flag
    bool public saleInitialized;

    // Reentrancy guard
    bool private locked;

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Initialize the sale. Callable once by the owner (typically the factory).
     * @param _saleToken Token being sold
     * @param _priceOracle PriceOracle providing USD prices for payment tokens (1e18 = $1)
     * @param _pricePerTokenUSD Sale price in USD per sale token (18 decimals)
     * @param _hardCap Max total sale tokens that can be sold (18 decimals)
     * @param _perWalletCap Max sale tokens per wallet (18 decimals); 0 disables the cap
     * @param _startTime UNIX seconds when the sale opens
     * @param _endTime UNIX seconds when the sale closes (must be > _startTime)
     */
    function initialize(
        address _saleToken,
        address _priceOracle,
        uint _pricePerTokenUSD,
        uint _hardCap,
        uint _perWalletCap,
        uint _startTime,
        uint _endTime
    ) external onlyOwner {
        require(!saleInitialized, "FixedPriceSale: already initialized");
        require(_saleToken != address(0), "FixedPriceSale: invalid sale token");
        require(_priceOracle != address(0), "FixedPriceSale: invalid oracle");
        require(_pricePerTokenUSD > 0, "FixedPriceSale: invalid price");
        require(_hardCap > 0, "FixedPriceSale: invalid hard cap");
        require(_endTime > _startTime, "FixedPriceSale: invalid schedule");

        WAD = 1e18;
        saleToken = _saleToken;
        priceOracle = PriceOracle(_priceOracle);
        pricePerTokenUSD = _pricePerTokenUSD;
        hardCap = _hardCap;
        perWalletCap = _perWalletCap;
        startTime = _startTime;
        endTime = _endTime;
        priceQuantizationUSD = 1e16; // $0.01
        saleInitialized = true;

        emit Initialized(
            _saleToken,
            _priceOracle,
            _pricePerTokenUSD,
            _hardCap,
            _perWalletCap,
            _startTime,
            _endTime
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════════

    modifier nonReentrant() {
        require(!locked, "FixedPriceSale: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier whenActive() {
        require(saleInitialized, "FixedPriceSale: not initialized");
        require(block.timestamp >= startTime, "FixedPriceSale: not started");
        require(block.timestamp < endTime, "FixedPriceSale: ended");
        _;
    }

    /**
     * @dev Fetch the oracle's payment-token price and round half-up to the nearest
     *      `priceQuantizationUSD` step (default $0.01). Reverts if the raw price is
     *      zero or the quantized price rounds to zero (e.g. tokens worth less than
     *      half a step are not buyable).
     */
    function _quantizedPaymentPrice(address paymentToken) internal view returns (uint) {
        uint raw = priceOracle.getAssetPrice(paymentToken);
        require(raw > 0, "FixedPriceSale: invalid payment price");
        uint q = priceQuantizationUSD;
        require(q > 0, "FixedPriceSale: invalid quantization");
        uint quantized = ((raw + (q / 2)) / q) * q;
        require(quantized > 0, "FixedPriceSale: quantized price is zero");
        return quantized;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BUY
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Purchase `saleAmount` sale tokens using `paymentToken`.
     * @param paymentToken Address of an accepted payment token
     * @param saleAmount Amount of sale tokens to buy (18 decimals)
     * @return paymentAmount Amount of `paymentToken` pulled from the buyer (18 decimals)
     *
     * Reverts if:
     *   - Sale not active (paused / outside window / not initialized)
     *   - paymentToken not whitelisted
     *   - saleAmount = 0
     *   - hard cap or per-wallet cap exceeded
     *   - oracle returns 0 price for the payment token
     *   - transferFrom on payment token or transfer of sale token fails
     */
    function buy(address paymentToken, uint saleAmount)
        external
        nonReentrant
        whenNotPaused
        whenActive
        returns (uint paymentAmount)
    {
        require(isSupportedPayment[paymentToken], "FixedPriceSale: payment not supported");
        require(saleAmount > 0, "FixedPriceSale: zero amount");
        require(totalSold + saleAmount <= hardCap, "FixedPriceSale: hard cap exceeded");

        if (perWalletCap > 0) {
            require(
                purchased[msg.sender] + saleAmount <= perWalletCap,
                "FixedPriceSale: per-wallet cap exceeded"
            );
        }

        // USD value of this purchase (1e18 = $1)
        uint usdValue = (saleAmount * pricePerTokenUSD) / WAD;
        require(usdValue > 0, "FixedPriceSale: zero usd value");

        // Convert USD value to payment-token amount using a price that's been
        // rounded to the nearest priceQuantizationUSD step (default $0.01).
        uint paymentPrice = _quantizedPaymentPrice(paymentToken);
        paymentAmount = (usdValue * WAD) / paymentPrice;
        require(paymentAmount > 0, "FixedPriceSale: zero payment amount");

        // Effects
        totalSold += saleAmount;
        purchased[msg.sender] += saleAmount;

        // Pull payment from buyer (held by this contract until swept)
        bool paymentOk = IERC20(paymentToken).transferFrom(msg.sender, address(this), paymentAmount);
        require(paymentOk, "FixedPriceSale: payment transfer failed");

        // Deliver sale tokens to buyer
        bool deliveryOk = IERC20(saleToken).transfer(msg.sender, saleAmount);
        require(deliveryOk, "FixedPriceSale: sale token transfer failed");

        emit Purchased(msg.sender, paymentToken, saleAmount, paymentAmount, usdValue);
        return paymentAmount;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // VIEW
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Quote how much `paymentToken` is required to buy `saleAmount` sale tokens
     *         at the current price and the quantized oracle reading. Does not consider
     *         caps or active window.
     */
    function quoteBuy(address paymentToken, uint saleAmount)
        external
        view
        returns (uint paymentAmount, uint usdValue)
    {
        require(isSupportedPayment[paymentToken], "FixedPriceSale: payment not supported");
        require(saleAmount > 0, "FixedPriceSale: zero amount");

        usdValue = (saleAmount * pricePerTokenUSD) / WAD;
        uint paymentPrice = _quantizedPaymentPrice(paymentToken);
        paymentAmount = (usdValue * WAD) / paymentPrice;
    }

    /**
     * @notice Get remaining sale tokens (hardCap - totalSold).
     */
    function remainingForSale() external view returns (uint) {
        if (totalSold >= hardCap) {
            return 0;
        }
        return hardCap - totalSold;
    }

    /**
     * @notice Get the remaining per-wallet allowance for a buyer.
     *         Returns the global per-wallet cap minus what they have purchased,
     *         or 0 if the cap is disabled (perWalletCap == 0).
     *         When the cap is disabled, callers should treat the cap as unbounded.
     */
    function remainingForWallet(address buyer) external view returns (uint) {
        if (perWalletCap == 0) {
            return 0;
        }
        if (purchased[buyer] >= perWalletCap) {
            return 0;
        }
        return perWalletCap - purchased[buyer];
    }

    /**
     * @notice Returns true while the sale is open (initialized, not paused, within window).
     */
    function isActive() external view returns (bool) {
        return saleInitialized
            && !paused()
            && block.timestamp >= startTime
            && block.timestamp < endTime;
    }

    /**
     * @notice Get all supported payment tokens.
     */
    function getSupportedPayments() external view returns (address[] memory) {
        return supportedPayments;
    }

    /**
     * @notice Get the amount of sale tokens still held by the contract (unsold inventory + dust).
     */
    function inventory() external view returns (uint) {
        return IERC20(saleToken).balanceOf(address(this));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Whitelist a payment token. Caller-supplied oracle price must be non-zero
     *         at quote/buy time; the oracle is not consulted here.
     */
    function addPaymentToken(address paymentToken) external onlyOwner {
        require(paymentToken != address(0), "FixedPriceSale: invalid payment token");
        require(!isSupportedPayment[paymentToken], "FixedPriceSale: already supported");

        isSupportedPayment[paymentToken] = true;
        supportedPayments.push(paymentToken);

        emit PaymentTokenAdded(paymentToken);
    }

    /**
     * @notice Remove a payment token from the whitelist. Any proceeds already collected
     *         in this token remain in the contract and can be swept via sweepProceeds.
     */
    function removePaymentToken(address paymentToken) external onlyOwner {
        require(isSupportedPayment[paymentToken], "FixedPriceSale: payment not supported");

        isSupportedPayment[paymentToken] = false;

        for (uint i = 0; i < supportedPayments.length; i++) {
            if (supportedPayments[i] == paymentToken) {
                address last = supportedPayments[supportedPayments.length - 1];
                supportedPayments[i] = last;
                supportedPayments[supportedPayments.length - 1] = address(0);
                supportedPayments.length -= 1;
                break;
            }
        }

        emit PaymentTokenRemoved(paymentToken);
    }

    function setPricePerToken(uint newPricePerTokenUSD) external onlyOwner {
        require(newPricePerTokenUSD > 0, "FixedPriceSale: invalid price");
        pricePerTokenUSD = newPricePerTokenUSD;
        emit PriceUpdated(newPricePerTokenUSD);
    }

    function setHardCap(uint newHardCap) external onlyOwner {
        require(newHardCap >= totalSold, "FixedPriceSale: cap below sold");
        hardCap = newHardCap;
        emit HardCapUpdated(newHardCap);
    }

    function setPerWalletCap(uint newPerWalletCap) external onlyOwner {
        perWalletCap = newPerWalletCap;
        emit PerWalletCapUpdated(newPerWalletCap);
    }

    function setSchedule(uint newStartTime, uint newEndTime) external onlyOwner {
        require(newEndTime > newStartTime, "FixedPriceSale: invalid schedule");
        startTime = newStartTime;
        endTime = newEndTime;
        emit ScheduleUpdated(newStartTime, newEndTime);
    }

    function setPriceOracle(address newPriceOracle) external onlyOwner {
        require(newPriceOracle != address(0), "FixedPriceSale: invalid oracle");
        priceOracle = PriceOracle(newPriceOracle);
        emit PriceOracleUpdated(newPriceOracle);
    }

    /**
     * @notice Update the payment-price quantization step (default 1e16 = $0.01).
     *         Set higher (e.g. 1e17 = $0.10) to round more aggressively, lower
     *         (e.g. 1e15 = $0.001) to quote sub-cent precision.
     */
    function setPriceQuantization(uint newPriceQuantizationUSD) external onlyOwner {
        require(newPriceQuantizationUSD > 0, "FixedPriceSale: invalid quantization");
        priceQuantizationUSD = newPriceQuantizationUSD;
        emit PriceQuantizationUpdated(newPriceQuantizationUSD);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PROCEEDS & SWEEPS
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Sweep up to `amount` of an accepted payment token to `to`.
     *         Owner-controlled; the sale just holds proceeds until this is called.
     */
    function sweepProceeds(address paymentToken, address to, uint amount) external onlyOwner {
        require(to != address(0), "FixedPriceSale: invalid recipient");
        require(amount > 0, "FixedPriceSale: zero amount");

        bool ok = IERC20(paymentToken).transfer(to, amount);
        require(ok, "FixedPriceSale: sweep transfer failed");

        emit ProceedsSwept(paymentToken, to, amount);
    }

    /**
     * @notice Sweep unsold sale-token inventory to `to`. Only callable after the sale closes
     *         to avoid removing inventory mid-sale.
     */
    function sweepUnsold(address to) external onlyOwner {
        require(to != address(0), "FixedPriceSale: invalid recipient");
        require(block.timestamp >= endTime, "FixedPriceSale: sale not ended");

        uint balance = IERC20(saleToken).balanceOf(address(this));
        require(balance > 0, "FixedPriceSale: no inventory");

        bool ok = IERC20(saleToken).transfer(to, balance);
        require(ok, "FixedPriceSale: sweep transfer failed");

        emit UnsoldSwept(to, balance);
    }

    /**
     * @notice Rescue an arbitrary token that was accidentally sent to the contract. Cannot be
     *         used on the sale token or on a whitelisted payment token (use sweepUnsold /
     *         sweepProceeds for those, which have stronger semantics).
     */
    function rescueToken(address token, address to, uint amount) external onlyOwner {
        require(to != address(0), "FixedPriceSale: invalid recipient");
        require(token != saleToken, "FixedPriceSale: cannot rescue sale token");
        require(!isSupportedPayment[token], "FixedPriceSale: cannot rescue payment token");

        bool ok = IERC20(token).transfer(to, amount);
        require(ok, "FixedPriceSale: rescue transfer failed");
    }
}
