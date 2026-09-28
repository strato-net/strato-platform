// SPDX-License-Identifier: MIT
import "PoolFactory.sol";
import "../Lending/PriceOracle.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Admin/FeeCollector.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";


contract record StablePool is Ownable {

    // ============ EVENTS ============

    event Transfer(address indexed sender, address indexed receiver, uint value);

    event Approval(address indexed owner, address indexed spender, uint value);

    event Swap(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    event AddLiquidity(address indexed provider, uint[] tokenAmounts, uint[] fees, uint invariant, uint tokenSupply);

    event RemoveLiquidity(address indexed provider, uint[] tokenAmounts, uint[] fees, uint tokenSupply);

    event RemoveLiquidityOne(address indexed provider, uint tokenid, uint tokenamount, uint coinamount, uint tokensupply);

    event RemoveLiquidityImbalance(address indexed provider, uint[] tokenAmounts, uint[] fees, uint invariant, uint tokenSupply);

    event RampA(uint oldA, uint newA, uint initialTime, uint futureTime);

    event StopRampA(uint A, uint t);

    event ApplyNewFee(uint fee, uint offpegFeeMultiplier);

    event SetNewMATime(uint maExpTime, uint DMaTime);

    event CoinAdded(address indexed coin, uint assetType, uint rateMultiplier, address oracle, uint initialAmount, uint lpMinted);

    event SetMaxDepositSlippage(uint maxDepositSlippage);

    event TokensMigrated(address indexed receiver, uint[] amounts, uint lpSupplyAtMigration);

    uint constant MAX_COINS = 8;

    uint constant PRECISION = 1e18;

    /// @notice LP locked forever at address(0xdead) on the first deposit, so no
    ///         first depositor can inflate the LP price (rebasing pools value
    ///         donations) and round every later depositor down to nothing.
    uint public constant MINIMUM_LIQUIDITY = 1000;

    PoolFactory private poolFactory;

    Token[] public record coins;

    uint[] assetTypes;

    bool private poolContainsRebasingTokens;

    mapping (address => uint) public record tokenBalances;

    mapping (address => uint) public record adminBalances;

    uint constant FEE_DENOMINATOR = 1e10;

    uint public fee;

    uint public offpegFeeMultiplier;

    uint public constant adminFee = 5e9;

    uint constant MAX_FEE = 5e9;

    uint constant A_PRECISION = 100;

    uint constant MAX_A = 1e6;

    uint constant MAX_A_CHANGE = 10;

    uint public initialA;

    uint public futureA;

    uint public initialATime;

    uint public futureATime;

    uint constant MIN_RAMP_TIME = 86400;

    mapping (address => uint) public record rateMultipliers;

    mapping (address => PriceOracle) public record rateOracles;

    address public usdst;

    uint[] callAmount;

    uint[] scaleFactor;

    uint[] lastPricesPacked;

    uint lastDPacked;

    uint public maExpTime;

    uint public DMaTime;

    uint maLastTime;

    uint constant ORACLE_BIT_MASK = ((1<<32) - 1) * (256**28);

    Token public tokenA; // Only here for cirrus indexing

    Token public tokenB; // Only here for cirrus indexing

    Token public lpToken;

    /// @notice Current exchange rate from tokenA to tokenB
    decimal public aToBRatio;

    /// @notice Current exchange rate from tokenB to tokenA
    decimal public bToARatio;

    /// @notice Current balance of tokenA in the pool
    uint public tokenABalance;

    /// @notice Current balance of tokenB in the pool
    uint public tokenBBalance;

    /// @notice Max tolerated shortfall for the deposit wrappers that take no
    ///         explicit minimum, in FEE_DENOMINATOR units. 0 means "use the
    ///         default", so pools upgraded in place stay protected.
    uint public maxDepositSlippage;

    uint constant DEFAULT_MAX_DEPOSIT_SLIPPAGE = 1e8; // 1% of FEE_DENOMINATOR

    bool public isStable = true;

    bool public isPaused = false;

    bool public isDisabled = false;

    // ============ STATE VARIABLES ============
    /// @notice Reentrancy guard to prevent recursive calls
    bool private locked;

    /// @notice Set once by _initialize so a pool cannot be re-initialised over
    ///         a live position set.
    bool private initialized;

    modifier nonReentrant() {
        require(!locked, "REENTRANT");
        locked = true;
        _;
        locked = false;
    }

    /// @notice Modifier to check if the caller is the pool factory
    modifier onlyPoolFactory() {
        require(
            msg.sender == address(poolFactory)
            || msg.sender == owner(), // admin override would be useful here
            "Caller is not PoolFactory");
        _;
    }

    modifier whenNotPaused() {
        require(!isPaused, "Pool is paused");
        _;
    }

    modifier whenNotDisabled() {
        require(!isDisabled, "Pool is disabled");
        _;
    }

    // ============ OWNER FUNCTIONS ============

    function setPaused(bool _isPaused) external onlyOwner {
        require(!isDisabled, "Pool pause cannot be set while isDisabled = true");
        isPaused = _isPaused;
    }

    function setDisabled(bool _isDisabled) external onlyOwner {
        isPaused = _isDisabled ? true : isPaused;
        isDisabled = _isDisabled;
    }

    function setMaxDepositSlippage(uint _maxDepositSlippage) external onlyOwner {
        require(_maxDepositSlippage <= FEE_DENOMINATOR / 10, "Tolerance above 10%");
        maxDepositSlippage = _maxDepositSlippage;
        emit SetMaxDepositSlippage(_maxDepositSlippage);
    }

    function setUsdst(address _usdst) external onlyOwner {
        require(_usdst != address(0), "Zero address");
        usdst = _usdst;
    }

    // ============ CONSTRUCTOR ============

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Initialize a new liquidity pool
    /// @param tokenAAddr The address of the first token in the pair
    /// @param tokenBAddr The address of the second token in the pair
    /// @param lpTokenAddr The address of the LP token contract
    /// @param _owner The address of the owner of the pool
    /// @dev Should be called by the PoolFactory contract
    function initialize(
        uint _a,
        uint _fee,
        uint _offpegFeeMultiplier,
        uint _maExpTime,
        address[] _coins,
        uint[] _rateMultipliers,
        uint[] _assetTypes,
        address[] _oracles,
        address _lpTokenAddr
    ) external virtual onlyOwner {
        _initialize(_a, _fee, _offpegFeeMultiplier, _maExpTime, _coins, _rateMultipliers, _assetTypes, _oracles, _lpTokenAddr);
    }

    function _initialize(
        uint _a,
        uint _fee,
        uint _offpegFeeMultiplier,
        uint _maExpTime,
        address[] _coins,
        uint[] _rateMultipliers,
        uint[] _assetTypes,
        address[] _oracles,
        address _lpTokenAddr
    ) internal {
        require(!initialized, "Already initialized");
        require(_lpTokenAddr != address(0), "Zero lpToken address");
        require(_coins.length >= 2, "Pool must have at least 2 tokens");
        require(_rateMultipliers.length == _coins.length, "rateMultipliers length mismatch");
        require(_assetTypes.length == _coins.length, "assetTypes length mismatch");
        require(_oracles.length == _coins.length, "oracles length mismatch");
        initialized = true;

        for (uint i = 0; i < _coins.length; i++) {
            require(_coins[i] != address(0), "Zero token address");
            for (uint k = 0; k < i; k++) {
                require(_coins[k] != _coins[i], "Duplicate token address");
            }
            coins.push(Token(_coins[i]));
            assetTypes.push(_assetTypes[i]);
            // G3: written as an `if`, not `flag = flag || (...)`. SolidVM parses
            // that assignment as `(flag = flag) || (...)` and never stores the
            // right-hand side, which left rebasing support permanently off.
            if (_assetTypes[i] == 2) {
                poolContainsRebasingTokens = true;
            }
            tokenBalances[_coins[i]] = 0;
            adminBalances[_coins[i]] = 0;
            rateMultipliers[_coins[i]] = _rateMultipliers[i];
        }
        tokenA = Token(_coins[0]);
        tokenB = Token(_coins[1]);
        tokenABalance = 0;
        tokenBBalance = 0;
        aToBRatio = 0.0;
        bToARatio = 0.0;
        lpToken = Token(_lpTokenAddr);
        isStable = true;
        isPaused = false;
        isDisabled = false;

        poolFactory = PoolFactory(msg.sender);

        uint a = _a * A_PRECISION;
        initialA = a;
        futureA = a;
        fee = _fee;
        offpegFeeMultiplier = _offpegFeeMultiplier;

        require(_maExpTime != 0, "maExpTime cannot be 0");
        maExpTime = _maExpTime;
        DMaTime = 62324; // 12 hours [sic]
        maLastTime = pack2(block.timestamp, block.timestamp);

        for (uint j = 0; j < coins.length; j++) {
            // push, not index-assign: SolidVM silently discards out-of-bounds
            // writes, so `callAmount[j] = 0` on an empty array was a no-op and
            // left these permanently out of step with addCoin's pushes.
            callAmount.push(0);
            scaleFactor.push(0);

            if (j < coins.length - 1) {
                lastPricesPacked.push(pack2(1e18, 1e18));
            }

            rateOracles[address(coins[j])] = PriceOracle(_oracles[j]);
        }
    }

    function _transferIn(uint coinIndex, uint dx, address sender, bool expectOptimisticTransfer) internal returns (uint) {
        require(coinIndex < coins.length, "Invalid coin index");
        address tokenAddr = address(coins[coinIndex]);
        uint _dx = ERC20(tokenAddr).balanceOf(this);

        if(expectOptimisticTransfer) {
            _dx = _dx - tokenBalances[tokenAddr];
            require(_dx >= dx, "Cannot transfer ??");
        } else {
            require(dx > 0, "Must transfer in more than 0 tokens");
            ERC20(tokenAddr).transferFrom(sender, this, dx);
            _dx = ERC20(tokenAddr).balanceOf(this) - _dx;
        }

        tokenBalances[tokenAddr] += _dx;
        if (coinIndex == 0) {
            tokenABalance += _dx;
        } else if (coinIndex == 1) {
            tokenBBalance += _dx;
        }

        return _dx;
    }

    function _transferOut(uint coinIndex, uint amount, address receiver) internal {
        require(receiver != address(0), "Cannot transfer to address 0");
        require(coinIndex < coins.length, "Invalid coin index");
        address tokenAddr = address(coins[coinIndex]);
        if (!poolContainsRebasingTokens) {
            tokenBalances[tokenAddr] -= amount;
            ERC20(tokenAddr).transfer(receiver, amount);
        } else {
            uint coinBalance = ERC20(tokenAddr).balanceOf(this);
            ERC20(tokenAddr).transfer(receiver, amount);
            tokenBalances[tokenAddr] = coinBalance - amount;
        }
        if (coinIndex == 0) {
            tokenABalance = tokenBalances[tokenAddr];
        } else if (coinIndex == 1) {
            tokenBBalance = tokenBalances[tokenAddr];
        }
    }

    function _storedRates() internal view returns (uint[]) {
        uint[] rates;
        for (uint i = 0; i < coins.length; i++) {
            address tokenAddr = address(coins[i]);
            uint oraclePrice = PRECISION;
            if (assetTypes[i] == 3) {
                require(usdst != address(0), "USDST address not set");
                uint xRate = uint(address(tokenAddr).call("exchangeRate"));
                address underlying = address(address(tokenAddr).call("asset"));
                if (address(rateOracles[tokenAddr]) != address(0) && underlying != usdst) {
                    oraclePrice = xRate * rateOracles[tokenAddr].getAssetPrice(underlying) / PRECISION;
                } else {
                    oraclePrice = xRate;
                }
            } else if (address(rateOracles[tokenAddr]) != address(0)) {
                oraclePrice = rateOracles[tokenAddr].getAssetPrice(tokenAddr);
            }
            rates.push(rateMultipliers[tokenAddr] * oraclePrice / PRECISION);
        }
        return rates;
    }

    function updateRateMultipliers(uint[] _rates) external onlyOwner {
        _updateRateMultipliers(_rates);
    }

    function updatePeg(uint _peg) external onlyOwner {
        uint[] rates = [0, _peg];
        for (uint i = 2; i < coins.length; i++) {
            rates.push(0);
        }
        _updateRateMultipliers(rates);
    }

    function _updateRateMultipliers(uint[] _rates) internal {
        for (uint i = 0; i < coins.length; i++) {
            if (_rates[i] != 0) {
                address tokenAddr = address(coins[i]);
                rateMultipliers[tokenAddr] = _rates[i];
            }
        }
    }

    function updateRateOraclesGeneral(address[] _oracles) external onlyOwner {
        _updateRateOraclesGeneral(_oracles);
    }

    function updateRateOracles(address _oracleA, address _oracleB) external onlyOwner {
        address[] oracles = [_oracleA, _oracleB];
        for (uint i = 2; i < coins.length; i++) {
            oracles.push(address(0xffffffffffffffffffffffffffffffffffffffff));
        }
        _updateRateOraclesGeneral(oracles);
    }

    function _updateRateOraclesGeneral(address[] _oracles) internal {
        for (uint i = 0; i < coins.length; i++) {
            if (_oracles[i] != address(0xffffffffffffffffffffffffffffffffffffffff)) { // Allow oracles to be set to 0
                address tokenAddr = address(coins[i]);
                rateOracles[tokenAddr] = _oracles[i];
            }
        }
    }

    function _balances() internal view returns (uint[]) {
        uint[] result;
        for (uint i = 0; i < coins.length; i++) {
            address tokenAddr = address(coins[i]);
            if (poolContainsRebasingTokens) {
                result.push(ERC20(tokenAddr).balanceOf(this) - adminBalances[tokenAddr]);
            } else {
                result.push(tokenBalances[tokenAddr] - adminBalances[tokenAddr]);
            }
        }
        return result;
    }

    function exchange(uint i, uint j, uint _dx, uint _minDy, address _receiver) external whenNotPaused nonReentrant returns (uint) {
        address receiver = _receiver == address(0) ? msg.sender : _receiver;
        return _exchange(msg.sender, i, j, _dx, _minDy, receiver, false);
    }

    function swap(
        bool isAToB,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external whenNotPaused nonReentrant returns (uint) {
        require(amountIn > 0 && minAmountOut > 0, "Invalid input");
        require(block.timestamp <= deadline, "EXPIRED");
        uint i = isAToB ? 0 : 1;
        uint j = isAToB ? 1 : 0;
        return _exchange(msg.sender, i, j, amountIn, minAmountOut, msg.sender, false);
    }

    /// @notice Swap coins that were transferred to the pool earlier in the SAME
    ///         transaction (router / zap pattern).
    /// @dev The entire surplus of coin i above the pool's ledger is treated as
    ///      the swap input and is claimable by ANY caller. Never transfer coins
    ///      to the pool and call this in a separate transaction.
    function exchangeReceived(uint i, uint j, uint _dx, uint _minDy, address _receiver) external whenNotPaused nonReentrant returns (uint) {
        require(!poolContainsRebasingTokens, "Cannot call exchangeReceived when the pool contains rebasing tokens");
        address receiver = _receiver == address(0) ? msg.sender : _receiver;
        return _exchange(msg.sender, i, j, _dx, _minDy, receiver, true);
    }

    function addLiquidityGeneral(uint[] _amounts, uint _minMintAmount, address _receiver) external whenNotPaused nonReentrant returns (uint) {
        return _addLiquidityGeneral(_amounts, _minMintAmount, _receiver);
    }

    function _addLiquidityGeneral(uint[] _amounts, uint _minMintAmount, address _receiver) internal returns (uint) {
        require(_amounts.length == coins.length, "Invalid array length for _amounts");
        address receiver = _receiver == address(0) ? msg.sender : _receiver;
        uint amp = _A();

        uint[] rates = _storedRates();
        uint[] oldBalances = _balances();
        uint d0 = getDMem(rates, oldBalances, amp);
        uint256 totalSupply = lpToken.totalSupply();

        uint[] newBalances;
        for(uint j = 0; j < coins.length; j++) {
            newBalances.push(oldBalances[j]);
            if(_amounts[j] > 0) {
                newBalances[j] += _transferIn(
                    j,
                    _amounts[j],
                    msg.sender,
                    false
                );
            } else {
                require(totalSupply != 0, "Cannot supply 0 when the pool is empty");
            }
        }

        uint d1 = getDMem(rates, newBalances, amp);

        require(d1 > d0, "D decreased after depositing tokens");

        uint[] fees;
        uint mintAmount = 0;

        if (totalSupply > 0) {
            uint idealBalance = 0;
            uint difference = 0;
            uint newBalance = 0;

            uint ys = (d0 + d1) / coins.length;
            uint xs = 0;
            uint dynamicFee_i = 0;

            uint baseFee = (fee * coins.length) / (4 * (coins.length - 1));

            for (uint k = 0; k < coins.length; k++) {
                idealBalance = d1 * oldBalances[k] / d0;
                difference = 0;
                newBalance = newBalances[k];

                if (idealBalance > newBalance) {
                    difference = idealBalance - newBalance;
                } else {
                    difference = newBalance - idealBalance;
                }

                xs = (rates[k] * (oldBalances[k] + newBalance)) / PRECISION;
                dynamicFee_i = _dynamicFee(xs, ys, baseFee);
                fees.push((dynamicFee_i * difference) / FEE_DENOMINATOR);
                adminBalances[address(coins[k])] += (fees[k] * adminFee) / FEE_DENOMINATOR;
                newBalances[k] -= fees[k];
            }

            uint[] xp = _xpMem(rates, newBalances);
            d1 = getD(xp, amp);
            mintAmount = (totalSupply * (d1 - d0)) / d0;
            // G4: deposits move the price too; keep the spot/EMA/D oracles
            // current the way Curve's add_liquidity does.
            upkeepOracles(xp, amp, d1);
        } else {
            // L1: the first deposit permanently locks MINIMUM_LIQUIDITY.
            require(d1 > MINIMUM_LIQUIDITY, "Initial deposit too small");
            lpToken.mint(address(0xdead), MINIMUM_LIQUIDITY);
            totalSupply = MINIMUM_LIQUIDITY;
            mintAmount = d1 - MINIMUM_LIQUIDITY;
            lastDPacked = pack2(d1, d1);
            uint[2] maLastTimeUnpacked = unpack2(maLastTime);
            if (maLastTimeUnpacked[1] < block.timestamp) {
                maLastTimeUnpacked[1] = block.timestamp;
                maLastTime = pack2(maLastTimeUnpacked[0], maLastTimeUnpacked[1]);
            }
        }

        require(mintAmount >= _minMintAmount, "Slippage: fewer LP tokens minted than the minimum");

        totalSupply += mintAmount;
        lpToken.mint(receiver, mintAmount);

        uint[] xpFinal = _xpMem(rates, newBalances);
        _updateRatios(rates, xpFinal, amp, d1);

        emit Transfer(address(0), receiver, mintAmount);
        emit AddLiquidity(msg.sender, _amounts, fees, d1, totalSupply);

        return mintAmount;
    }

    function addLiquidity(
        uint256 tokenBAmount,
        uint256 maxTokenAAmount,
        uint256 deadline
    ) external whenNotPaused nonReentrant returns (uint256) {
        require(tokenBAmount > 0 && maxTokenAAmount > 0, "Invalid inputs");
        require(block.timestamp <= deadline, "EXPIRED");
        uint[] amounts = _dualAmounts(tokenBAmount, maxTokenAAmount);
        return _addLiquidityGeneral(amounts, _minMintFloor(amounts), msg.sender);
    }

    /// @notice addLiquidity with a caller-supplied floor on the LP minted.
    function addLiquidityWithMin(
        uint256 tokenBAmount,
        uint256 maxTokenAAmount,
        uint256 minLpOut,
        uint256 deadline
    ) external whenNotPaused nonReentrant returns (uint256) {
        require(tokenBAmount > 0 && maxTokenAAmount > 0, "Invalid inputs");
        require(block.timestamp <= deadline, "EXPIRED");
        return _addLiquidityGeneral(_dualAmounts(tokenBAmount, maxTokenAAmount), minLpOut, msg.sender);
    }

    /// @dev Sizes a balanced deposit: tokenA is derived from the pool ratio and
    ///      maxTokenAAmount is enforced as the cap its name promises (F7).
    function _dualAmounts(uint256 tokenBAmount, uint256 maxTokenAAmount) internal view returns (uint[]) {
        uint[] amounts;
        for (uint i = 0; i < coins.length; i++) {
            amounts.push(0);
        }
        if (lpToken.totalSupply() > 0) {
            uint[] balances = _balances();
            require(balances[1] > 0, "Pool has no tokenB");
            uint tokenAAmount = (tokenBAmount * balances[0]) / balances[1];
            require(maxTokenAAmount >= tokenAAmount, "Insufficient tokenA amount");
            amounts[0] = tokenAAmount;
        } else {
            amounts[0] = maxTokenAAmount;
        }
        amounts[1] = tokenBAmount;
        return amounts;
    }

    function addLiquiditySingleToken(
        bool isAToB,
        uint256 amountIn,
        uint256 deadline
    ) external whenNotPaused nonReentrant returns (uint256 liquidityMinted) {
        require(amountIn > 0, "Invalid input");
        require(block.timestamp <= deadline, "EXPIRED");
        require(lpToken.totalSupply() > 0, "POOL_EMPTY");
        uint[] amounts = _singleAmounts(isAToB, amountIn);
        return _addLiquidityGeneral(amounts, _minMintFloor(amounts), msg.sender);
    }

    /// @notice addLiquiditySingleToken with a caller-supplied floor on the LP minted.
    function addLiquiditySingleTokenWithMin(
        bool isAToB,
        uint256 amountIn,
        uint256 minLpOut,
        uint256 deadline
    ) external whenNotPaused nonReentrant returns (uint256) {
        require(amountIn > 0, "Invalid input");
        require(block.timestamp <= deadline, "EXPIRED");
        require(lpToken.totalSupply() > 0, "POOL_EMPTY");
        return _addLiquidityGeneral(_singleAmounts(isAToB, amountIn), minLpOut, msg.sender);
    }

    function _singleAmounts(bool isAToB, uint256 amountIn) internal view returns (uint[]) {
        uint[] amounts;
        for (uint i = 0; i < coins.length; i++) {
            amounts.push(0);
        }
        if (isAToB) {
            amounts[0] = amountIn;
        } else {
            amounts[1] = amountIn;
        }
        return amounts;
    }

    /// @dev Default slippage floor for the wrappers that take no explicit
    ///      minimum (F7). Values the deposit at the pool's own virtual price
    ///      (D / totalSupply) and allows maxDepositSlippage below that, so a
    ///      front-run that moves the price against the depositor reverts
    ///      instead of silently minting whatever is left.
    function _minMintFloor(uint[] amounts) internal view returns (uint) {
        uint totalSupply = lpToken.totalSupply();
        if (totalSupply == 0) {
            return 0; // first deposit defines the price; nothing to compare against
        }

        uint[] rates = _storedRates();
        uint d0 = getDMem(rates, _balances(), _A());
        if (d0 == 0) {
            return 0;
        }

        uint depositValue = 0;
        for (uint i = 0; i < coins.length; i++) {
            depositValue += (rates[i] * amounts[i]) / PRECISION;
        }

        uint idealMint = (depositValue * totalSupply) / d0;
        uint tolerance = maxDepositSlippage == 0 ? DEFAULT_MAX_DEPOSIT_SLIPPAGE : maxDepositSlippage;
        return (idealMint * (FEE_DENOMINATOR - tolerance)) / FEE_DENOMINATOR;
    }

    /// @dev G5: whenNotPaused as well as whenNotDisabled. A one-coin exit is a
    ///      swap priced by the curve; a paused (mispricing) pool must not honour
    ///      it. Proportional removeLiquidityGeneral stays open while paused.
    function removeliquidityOneCoin(uint _burnAmount, uint i, uint _minReceived, address _receiver) external whenNotPaused whenNotDisabled nonReentrant returns (uint) {
        require(i < coins.length, "Coin index out of range");
        require(_burnAmount > 0, "Cannot remove 0 liquidity");
        address receiver = _receiver == address(0) ? msg.sender : _receiver;
        uint dy = 0;
        uint withdrawFee = 0;
        uint[] xp;
        uint amp = 0;
        uint d = 0;

        (dy, withdrawFee, xp, amp, d) = _calcWithdrawOneCoin(_burnAmount, i);

        require(dy >= _minReceived, "Not enough coins removed");

        adminBalances[address(coins[i])] += (withdrawFee * adminFee) / FEE_DENOMINATOR;

        // F1: burn the caller's LP, never the receiver's. `_receiver` chooses
        // where the withdrawn coin lands, it must not choose whose position closes.
        lpToken.burn(msg.sender, _burnAmount);

        _transferOut(i, dy, receiver);

        emit RemoveLiquidityOne(msg.sender, i, _burnAmount, dy, lpToken.totalSupply());

        upkeepOracles(xp, amp, d);
        _updateRatios(_storedRates(), xp, amp, d);

        return dy;
    }

    /// @dev G5: see removeliquidityOneCoin.
    function removeLiquidityImbalance(uint[] _amounts, uint _maxBurnAmount, address _receiver) external whenNotPaused whenNotDisabled nonReentrant returns (uint) {
        address receiver = _receiver == address(0) ? msg.sender : _receiver;
        uint amp = _A();
        uint[] rates = _storedRates();
        uint[] oldBalances = _balances();
        uint[] newBalances = _balances();
        require(_amounts.length == coins.length, "Invalid array length for _amounts");
        uint d0 = getDMem(rates, oldBalances, amp);
        for (uint j = 0; j < coins.length; j++) {
            if (_amounts[j] > 0) {
                require(_amounts[j] <= newBalances[j], "Withdrawal exceeds pool balance");
                newBalances[j] -= _amounts[j];
            }
        }

        uint d1 = getDMem(rates, newBalances, amp);
        uint baseFee = (fee * coins.length) / (4 * (coins.length - 1));
        uint ys = (d0 + d1) / coins.length;

        uint[] fees;
        uint dynamicFee = 0;
        uint xs = 0;
        uint idealBalance = 0;
        uint difference = 0;
        uint newBalance = 0;

        for (uint k = 0; k < coins.length; k++) {
            idealBalance = (d1 * oldBalances[k]) / d0;
            difference = 0;
            newBalance = newBalances[k];

            if (idealBalance > newBalance) {
                difference = idealBalance - newBalance;
            } else {
                difference = newBalance - idealBalance;
            }

            xs = (rates[k] * (oldBalances[k] + newBalance)) / PRECISION;
            dynamicFee = _dynamicFee(xs, ys, baseFee);
            fees.push((dynamicFee * difference) / FEE_DENOMINATOR);

            adminBalances[address(coins[k])] += (fees[k] * adminFee) / FEE_DENOMINATOR;
            newBalances[k] -= fees[k];
        }

        d1 = getDMem(rates, newBalances, amp);
        upkeepOracles(_xpMem(rates, newBalances), amp, d1);

        uint totalSupply = lpToken.totalSupply();
        uint burnAmount = (((d0 - d1) * totalSupply) / d0) + 1;
        require(burnAmount > 1, "Zero tokens burned");
        require(burnAmount <= _maxBurnAmount, "Slippage screwed you");

        // F9: burn before the coins leave the contract.
        lpToken.burn(msg.sender, burnAmount);

        for (uint t = 0; t < coins.length; t++) {
            if (_amounts[t] > 0) {
                _transferOut(t, _amounts[t], receiver);
            }
        }

        uint[] xp = _xpMem(rates, _balances());
        _updateRatios(rates, xp, amp, d1);

        emit RemoveLiquidityImbalance(
            msg.sender,
            _amounts,
            fees,
            d1,
            totalSupply - burnAmount
        );

        return burnAmount;
    }

    function removeLiquidity(
        uint256 lpTokenAmount,
        uint256 minTokenBAmount,
        uint256 minTokenAAmount,
        uint256 deadline
    ) external whenNotDisabled nonReentrant returns (uint256, uint256) {
        require(lpTokenAmount > 0 && minTokenBAmount > 0 && minTokenAAmount > 0, "Invalid inputs");
        require(block.timestamp <= deadline, "EXPIRED");
        uint256 totalLiquidity = lpToken.totalSupply();
        require(totalLiquidity > 0, "No liquidity");
        uint[] minAmounts;
        for (uint i = 0; i < coins.length; i++) {
            minAmounts.push(0);
        }
        minAmounts[0] = minTokenAAmount;
        minAmounts[1] = minTokenBAmount;
        uint[] rets = _removeLiquidityGeneral(lpTokenAmount, minAmounts, msg.sender, true);
        return (rets[1], rets[0]);
    }

    function removeLiquidityGeneral(uint _burnAmount, uint[] _minAmounts, address _receiver, bool _claimAdminFees) external whenNotDisabled nonReentrant returns (uint[]) {
        return _removeLiquidityGeneral(_burnAmount, _minAmounts, _receiver, _claimAdminFees);
    }

    function _removeLiquidityGeneral(uint _burnAmount, uint[] _minAmounts, address _receiver, bool _claimAdminFees) internal returns (uint[]) {
        address receiver = _receiver == address(0) ? msg.sender : _receiver;
        require(_burnAmount > 0, "Invalid burn amount");
        require(_minAmounts.length == coins.length, "Invalid array length for _minAmounts");

        // F2c: sweep the protocol fees to the collector *before* the payout is
        // sized, not after. Sweeping afterwards tried to pay the collector out
        // of coins that had already been handed to the exiting LP.
        if (_claimAdminFees) {
            _withdrawAdminFees();
        }

        uint totalSupply = lpToken.totalSupply();
        require(totalSupply > 0, "No liquidity");

        // F2: pro-rate over _balances() (net of any protocol fees still owed),
        // not the raw tokenBalances ledger.
        uint[] balances = _balances();

        uint[] amounts;
        uint[] fees;

        uint value = 0;
        for (uint i = 0; i < coins.length; i++) {
            value = (balances[i] * _burnAmount) / totalSupply;
            require(value >= _minAmounts[i], "Withdrawal resulted in fewer coins than expected");
            amounts.push(value);
            fees.push(0);
        }

        // F9: burn first, pay out second, so a re-entrant call can never see the
        // pool drained while totalSupply is still stale.
        lpToken.burn(msg.sender, _burnAmount);

        for (uint t = 0; t < coins.length; t++) {
            _transferOut(t, amounts[t], receiver);
        }

        uint[2] maLastTimeUnpacked = unpack2(maLastTime);
        uint lastDPackedCurrent = lastDPacked;
        uint oldD = lastDPackedCurrent & ((1<<128) - 1);
        uint newD = oldD - (oldD * _burnAmount / totalSupply);
        lastDPacked = pack2(
            newD,
            _calcMovingAverage(
                lastDPackedCurrent,
                DMaTime,
                maLastTimeUnpacked[1]
            )
        );

        if (maLastTimeUnpacked[1] < block.timestamp) {
            maLastTimeUnpacked[1] = block.timestamp;
            maLastTime = pack2(maLastTimeUnpacked[0], maLastTimeUnpacked[1]);
        }

        emit RemoveLiquidity(
            msg.sender,
            amounts,
            fees,
            totalSupply - _burnAmount
        );

        uint[] rates = _storedRates();
        uint[] xp = _xpMem(rates, _balances());
        _updateRatios(rates, xp, _A(), newD);

        return amounts;
    }

    function withdrawAdminFees() external nonReentrant {
        _withdrawAdminFees();
    }

    function _dynamicFee(uint xpi, uint xpj, uint _fee) internal view returns (uint) {
        uint _offpegFeeMultiplier = offpegFeeMultiplier;
        if (_offpegFeeMultiplier <= FEE_DENOMINATOR) {
            return _fee;
        }

        uint xps2 = (xpi + xpj) * (xpi + xpj);
        return (_offpegFeeMultiplier * _fee) / ((((_offpegFeeMultiplier - FEE_DENOMINATOR) * 4 * xpi * xpj) / xps2) + FEE_DENOMINATOR);
    }

    function __exchange(uint x, uint[] _xp, uint[] rates, uint i, uint j) internal returns (uint, uint, uint) {
        uint amp = _A();
        uint d = getD(_xp, amp);
        uint y = getY(i, j, x, _xp, amp, d);

        uint dy = _xp[j] - y - 1;
        uint dyFee = (dy * _dynamicFee((_xp[i] + x) / 2, (_xp[j] + y) / 2, fee)) / FEE_DENOMINATOR;

        dy = ((dy - dyFee) * PRECISION) / rates[j];

        adminBalances[address(coins[j])] += ((dyFee * adminFee / FEE_DENOMINATOR) * PRECISION) / rates[j];

        uint[] xp;
        for (uint z = 0; z < _xp.length; z++) {
            xp.push(_xp[z]);
        }
        xp[i] = x;
        xp[j] = y;
        upkeepOracles(xp, amp, d);

        return (dy, amp, d);
    }

    function _exchange(address sender, uint i, uint j, uint _dx, uint _minDy, address _receiver, bool expectOptimisticTransfer) internal returns (uint) {
        require(i < coins.length && j < coins.length, "Coin index out of range");
        require(i != j, "Cannot exchange a coin with itself");
        require(_dx > 0, "Cannot exchange 0 coins");

        uint[] rates = _storedRates();
        uint[] oldBalances = _balances();
        uint[] xp = _xpMem(rates, oldBalances);

        uint dx = _transferIn(i, _dx, sender, expectOptimisticTransfer);

        uint x = xp[i] + ((dx * rates[i]) / PRECISION);
        (uint dy, uint amp, uint d) = __exchange(x, xp, rates, i, j);
        require(dy >= _minDy, "Exchange resulted in fewer coins than expected");

        _transferOut(j, dy, _receiver);

        xp = _xpMem(rates, _balances());
        _updateRatios(rates, xp, amp, d);

        emit Swap(msg.sender, address(coins[i]), address(coins[j]), dx, dy);

        return dy;
    }

    function _withdrawAdminFees() internal {
        address feeReceiver = poolFactory.feeCollector();
        if (feeReceiver == address(0)) {
            return;
        }

        for (uint i = 0; i < coins.length; i++) {
            if (adminBalances[address(coins[i])] > 0) {
                _transferOut(i, adminBalances[address(coins[i])], feeReceiver);
                adminBalances[address(coins[i])] = 0;
            }
        }
    }

    function getY(uint i, uint j, uint x, uint[] xp, uint _amp, uint _d) internal view returns (uint) {
        require(i != j, "getY: Same coin");
        require(i >= 0, "getY: i below zero");
        require(i < coins.length, "getY: i above coins.length");
        require(j >= 0, "getY: j below zero");
        require(j < coins.length, "getY: j above coins.length");

        uint amp = _amp;
        uint d = _d;

        uint s_ = 0;
        uint _x = 0;
        uint y_prev = 0;
        uint c = d;
        uint ann = amp * coins.length;

        for (uint _i = 0; _i < coins.length; _i++) {
            if (_i == i) {
                _x = x;
            } else if (_i != j) {
                _x = xp[_i];
            } else {
                continue;
            }

            s_ += _x;
            c = (c * d) / (_x * coins.length);
        }

        c = (c * d * A_PRECISION) / (ann * coins.length);
        uint b = s_ + ((d * A_PRECISION) / ann);
        uint y = d;

        for (uint _j = 0; _j < 256; _j++) {
            y_prev = y;
            y = ((y*y) + c) / (2 * y + b - d);

            if (y > y_prev) {
                if (y - y_prev <= 1) {
                    return y;
                }
            } else {
                if (y_prev - y <= 1) {
                    return y;
                }
            }
        }

        revert("getY did not converge after 256 iterations");
        return 0; // SolidVM is making me return this unreachable line
    }

    function getD(uint[] _xp, uint _amp) internal view returns (uint) {
        uint s = 0;
        for (uint x = 0; x < _xp.length; x++) {
            if (_xp[x] == 0) return 0;
            s += _xp[x];
        }
        if (s == 0) {
            return 0;
        }

        uint d = s;
        uint ann = _amp * coins.length;

        for (uint i = 0; i < 256; i++) {
            uint d_p = d;
            for (uint y = 0; y < _xp.length; y++) {
                d_p = (d_p * d) / _xp[y];
            }
            d_p /= (coins.length ** coins.length);
            uint dPrev = d;

            d = (
                ((ann * s / A_PRECISION) + d_p * coins.length) * d
                /
                ((((ann - A_PRECISION) * d) / A_PRECISION) + ((coins.length + 1) * d_p))
            );

            if (d > dPrev) {
                if (d - dPrev <= 1) {
                    return d;
                }
            } else {
                if (dPrev - d <= 1) {
                    return d;
                }
            }
        }

        revert("getD did not converge after 256 iterations");
        return 0; // SolidVM is making me return this unreachable line
    }

    function getYD(uint a, uint i, uint[] xp, uint d) internal view returns (uint) {
        require(i >= 0, "getYD: i below zero");
        require(i < coins.length, "getYD: i above coins.length");

        uint s_ = 0;
        uint _x = 0;
        uint yPrev = 0;
        uint c = d;
        uint ann = a * coins.length;

        for (uint _i = 0; _i < coins.length; _i++) {
            if (_i != i) {
                _x = xp[_i];
            } else {
                continue;
            }

            s_ += _x;
            c = (c * d) / (_x * coins.length);
        }

        c = c * d * A_PRECISION / (ann * coins.length);
        uint b = s_ + (d * A_PRECISION / ann);
        uint y = d;

        for (uint _j = 0; _j < 256; _j++) {
            yPrev = y;
            y = (y*y + c) / (2 * y + b - d);

            if (y > yPrev) {
                if (y - yPrev <= 1) {
                    return y;
                }
            } else {
                if (yPrev - y <= 1) {
                    return y;
                }
            }
        }

        revert("getYD did not converge after 256 iterations");
        return 0; // SolidVM is making me return this unreachable line
    }

    function _A() internal view returns (uint) {
        uint t1 = futureATime;
        uint a1 = futureA;

        if (block.timestamp < t1) {
            uint a0 = initialA;
            uint t0 = initialATime;

            if (a1 > a0) {
                return a0 + (((a1 - a0) * (block.timestamp - t0)) / (t1 - t0));
            } else {
                return a0 - (((a0 - a1) * (block.timestamp - t0)) / (t1 - t0));
            }
        } else {
            return a1;
        }
    }

    function _xpMem(uint[] _rates, uint[] _balances) internal view returns (uint[]) {
        uint[] result;
        for (uint i = 0; i < coins.length; i++) {
            result.push((_rates[i] * _balances[i]) / PRECISION);
        }

        return result;
    }

    function getDMem(uint[] _rates, uint[] _balances, uint _amp) internal view returns (uint) {
        uint[] xp = _xpMem(_rates, _balances);
        return getD(xp, _amp);
    }

    function _calcWithdrawOneCoin(uint _burnAmount, uint i) internal view returns (uint, uint, uint[], uint, uint) {
        uint amp = _A();
        uint[] rates = _storedRates();
        // F2: value the pool at _balances(), which nets off the unclaimed protocol
        // fees. tokenBalances still contains them and would pay them to the LP.
        uint[] balances = _balances();
        uint[] xp = _xpMem(rates, balances);
        uint d0 = getD(xp, amp);

        uint totalSupply = lpToken.totalSupply();
        uint d1 = d0 - _burnAmount * d0 / totalSupply;
        uint newY = getYD(amp, i, xp, d1);

        uint baseFee = (fee * coins.length) / (4 * (coins.length - 1));
        uint[] xpReduced = xp;
        uint ys = (d0 + d1) / (2 * coins.length);

        uint dxExpected = 0;
        uint xpJ = 0;
        uint xAvg = 0;
        uint dynamicFee = 0;

        for (uint j = 0; j < coins.length; j++) {
            dxExpected = 0;
            xpJ = xp[j];

            if (j == i) {
                // G1: Curve's `xp_j * D1 / D0 - new_y`, the imbalance this
                // withdrawal creates on coin i. The previous
                // `(xpJ * d1) / (d0 - newY)` was roughly the whole reserve, so
                // the fee was charged on the entire reserve of coin i.
                dxExpected = (xpJ * d1) / d0 - newY;
                xAvg = (xpJ + newY) / 2;
            } else {
                dxExpected = xpJ - (xpJ * d1 / d0);
                xAvg = xpJ;
            }

            dynamicFee = _dynamicFee(xAvg, ys, baseFee);
            xpReduced[j] = xpJ - ((dynamicFee * dxExpected) / FEE_DENOMINATOR);
        }

        uint dy = xpReduced[i] - getYD(amp, i, xpReduced, d1);
        uint dy0 = (xp[i] - newY) * PRECISION / rates[i];
        dy = ((dy - 1) * PRECISION) / rates[i];

        xp[i] = newY;

        return (dy, dy0 - dy, xp, amp, d1);
    }

    function pack2(uint p1, uint p2) internal pure returns (uint) {
        require(p1 < 1 << 128, "p1 greater than 2^128");
        require(p2 < 1 << 128, "p2 greater than 2^128");
        return p1 | (p2 << 128);
    }

    function unpack2(uint p) internal pure returns (uint[2]) {
        return [p & ((1<<128) - 1), p >> 128];
    }

    /// @notice Marginal price of each coin quoted in coin 0, scaled to 1e18.
    /// @return An array of length coins.length - 1, where entry i is the price
    ///         of coin i+1. Coin 0 priced in coin 0 is trivially 1e18 and is
    ///         deliberately not returned - emitting it (F3) shifted every real
    ///         price one slot away from the consumers that read this.
    function _getP(uint[] xp, uint amp, uint d) internal view returns (uint[]) {
        uint[] p;
        bool anyZero = false;
        for (uint x = 0; x < coins.length; x++) {
            if (x > 0) {
                p.push(0);
            }
            if (xp[x] == 0) {
                anyZero = true;
            }
        }

        if (anyZero) {
            return p;
        }

        uint ann = amp * coins.length;
        uint dr = d / (coins.length ** coins.length);

        for (uint i = 0; i < coins.length; i++) {
            dr = (dr * d) / xp[i];
        }

        uint xp0A = (ann * xp[0]) / A_PRECISION;

        for (uint j = 1; j < coins.length; j++) {
            p[j - 1] = 1e18 * (xp0A + (dr * xp[0] / xp[j])) / (xp0A + dr);
        }

        return p;
    }

    function upkeepOracles(uint[] xp, uint amp, uint d) internal {
        uint[2] maLastTimeUnpacked = unpack2(maLastTime);
        uint[] lastPricesPackedCurrent = lastPricesPacked;
        uint[] lastPricesPackedNew = lastPricesPackedCurrent;
        uint[] spotPrice = _getP(xp, amp, d);
        for (uint i = 0; i < coins.length - 1; i++) {
            if (spotPrice[i] != 0) {
                lastPricesPackedNew[i] = pack2(
                    spotPrice[i] < 2e18 ? spotPrice[i] : 2e18,
                    _calcMovingAverage(
                        lastPricesPackedCurrent[i],
                        maExpTime,
                        maLastTimeUnpacked[0]
                    )
                );
            }
        }

        lastPricesPacked = lastPricesPackedNew;

        uint lastDPackedCurrent = lastDPacked;
        lastDPacked = pack2(
            d,
            _calcMovingAverage(
                lastDPackedCurrent,
                DMaTime,
                maLastTimeUnpacked[1]
            )
        );

        if (maLastTimeUnpacked[0] < block.timestamp) {
            maLastTimeUnpacked[0] = block.timestamp;
        }
        if (maLastTimeUnpacked[1] < block.timestamp) {
            maLastTimeUnpacked[1] = block.timestamp;
        }

        maLastTime = pack2(maLastTimeUnpacked[0], maLastTimeUnpacked[1]);
    }

    function _calcMovingAverage(uint packedValue, uint averagingWindow, uint _maLastTime) internal view returns (uint) {
        uint lastSpotValue = packedValue & ((1 << 128) - 1);
        uint lastEmaValue = packedValue >> 128;

        if (_maLastTime < block.timestamp) {
            uint alpha = exp(
                -int(((block.timestamp - _maLastTime) * 1e18) / averagingWindow)
            );
            return (lastSpotValue * (1e18 - alpha) + lastEmaValue * alpha) / 1e18;
        }
        return lastEmaValue;
    }

    function _updateRatios(uint[] rates, uint[] xp, uint amp, uint d) internal {
        uint[] ps = _getP(xp, amp, d);
        // ps[0] is now the price of coin 1 in coin 0. Coin 0's own price is the
        // implicit 1e18 that _getP no longer returns, so state it here.
        if (ps.length == 0 || ps[0] == 0) {
            aToBRatio = 0.0;
            bToARatio = 0.0;
            return;
        }
        decimal priceA = decimal(PRECISION * rates[0]).truncate(18);
        decimal priceB = decimal(ps[0] * rates[1]).truncate(18);
        aToBRatio = priceB == 0.0 ? 0.0 : priceA / priceB;
        bToARatio = priceA == 0.0 ? 0.0 : priceB / priceA;
    }

    /// @notice Last recorded spot price of coin i+1 quoted in coin 0.
    function lastPrice(uint i) external view returns (uint) {
        require(i < coins.length - 1, "Price index out of range");
        return lastPricesPacked[i] & ((1 << 128) - 1);
    }

    /// @notice Moving average of coin i+1's price as of the last write.
    function emaPrice(uint i) external view returns (uint) {
        require(i < coins.length - 1, "Price index out of range");
        return lastPricesPacked[i] >> 128;
    }

    /// @notice Spot price of coin i+1 quoted in coin 0, scaled to 1e18.
    /// @param i Index into the price array: 0 .. coins.length - 2.
    function getP(uint i) external view returns (uint) {
        require(i < coins.length - 1, "Price index out of range");
        uint amp = _A();
        uint[] xp = _xpMem(_storedRates(), _balances());
        uint d = getD(xp, amp);
        return _getP(xp, amp, d)[i];
    }

    /// @notice Time-weighted price of coin i+1 quoted in coin 0.
    function priceOracle(uint i) external view returns (uint) {
        require(i < coins.length - 1, "Price index out of range");
        return _calcMovingAverage(lastPricesPacked[i], maExpTime, maLastTime & ((1 << 128) - 1));
    }

    function dOracle() external view returns (uint) {
        return _calcMovingAverage(lastDPacked, DMaTime, maLastTime >> 128);
    }

    function exp(int x) internal pure returns (uint) {
        int value = x;
        if (x <= -41446531673892822313) return 0;
        require(x < 135305999368893231589, "wad_exp overflow");

        value = (x << 78) / (5 ** 18);

        int k = (((value << 96) / 54916777467707473351141471128) + (1 << 95)) >> 96;
        value = value - (k * 54916777467707473351141471128);

        int y = (((value + 1346386616545796478920950773328) * value) >> 96) + 57155421227552351082224309758442;
        int p = ((((((y + value) - 94201549194550492254356042504812) * y) >> 96)
          + 28719021644029726153956944680412240) * value) + (4385272521454847904659076985693276 << 96);

        int q = (((value - 2855989394907223263936484059900) * value) >> 96) + 50020603652535783019961831881945;
        q = ((q * value) >> 96) - 533845033583426703283633433725380;
        q = ((q * value) >> 96) + 3604857256930695427073651918091429;
        q = ((q * value) >> 96) - 14423608567350463180887372962807573;
        q = ((q * value) >> 96) + 26449188498355588339934803723976023;

        int r = p / q;

        return (uint(r) * 3822833074963236453042738258902158003155416615667) >> uint(195 - k);
    }

    function rampA(uint _futureA, uint _futureTime) external onlyOwner {
        require(block.timestamp >= initialATime + MIN_RAMP_TIME, "Not time to ramp A yet");
        require(_futureTime >= block.timestamp + MIN_RAMP_TIME, "Insufficient time");

        uint _initialA = _A();
        uint _futureAp = _futureA * A_PRECISION;

        require(_futureA > 0 && _futureA < MAX_A, "Future A cannot exceed MAX_A");
        if (_futureAp < _initialA) {
            require(_futureAp * MAX_A_CHANGE >= _initialA, "futureAp is too small");
        } else {
            require(_futureAp <= _initialA * MAX_A_CHANGE, "futureAp is too big");
        }

        initialA = _initialA;
        futureA = _futureAp;
        initialATime = block.timestamp;
        futureATime = _futureTime;

        emit RampA(_initialA, _futureAp, block.timestamp, _futureTime);
    }

    function stopRampA() external onlyOwner {
        uint currentA = _A();
        initialA = currentA;
        futureA = currentA;
        initialATime = block.timestamp;
        futureATime = block.timestamp;

        emit StopRampA(currentA, block.timestamp);
    }

    function setNewFee(uint _newFee, uint _newOffpegFeeMultiplier) external onlyOwner {
        require(_newFee <= MAX_FEE, "Cannot set fee higher than MAX_FEE");
        fee = _newFee;

        require(_newOffpegFeeMultiplier * _newFee <= MAX_FEE * FEE_DENOMINATOR, "Offpeg multiplier exceeds maximum");
        offpegFeeMultiplier = _newOffpegFeeMultiplier;

        emit ApplyNewFee(_newFee, _newOffpegFeeMultiplier);
    }

    function setMaExpTime(uint _maExpTime, uint _DMaTime) external onlyOwner {
        require(_maExpTime * _DMaTime > 0, "0 in input values");

        maExpTime = _maExpTime;
        DMaTime = _DMaTime;

        emit SetNewMATime(_maExpTime, _DMaTime);
    }

    // ============ ADD COIN ============

    /// @notice Add a new coin to the pool with initial liquidity
    /// @param _coin The address of the new token to add
    /// @param _rateMultiplier The rate multiplier for the new token
    /// @param _assetType The asset type (1=normal, 2=rebasing)
    /// @param _oracle The price oracle address for the new token (address(0) if none)
    /// @param _initialAmount The initial deposit amount for the new token. Must be
    ///        large enough to raise the pool invariant (about 4% of the per-coin
    ///        balance at A = 100) or the call reverts.
    /// @param _depositor The address providing the initial deposit (must have approved this pool)
    /// @return mintAmount LP minted to the depositor, proportional to the invariant increase
    function addCoin(
        address _coin,
        uint _rateMultiplier,
        uint _assetType,
        address _oracle,
        uint _initialAmount,
        address _depositor
    ) external onlyPoolFactory nonReentrant returns (uint) {
        require(coins.length < MAX_COINS, "Max coins reached");
        require(_coin != address(0), "Zero token address");
        require(_initialAmount > 0, "Initial amount must be > 0");
        require(_depositor != address(0), "Zero depositor address");
        require(_rateMultiplier > 0, "Rate multiplier must be > 0");

        // Check coin not already in pool
        for (uint i = 0; i < coins.length; i++) {
            require(address(coins[i]) != _coin, "Coin already in pool");
        }

        uint totalSupply = lpToken.totalSupply();
        require(totalSupply > 0, "Pool must have existing liquidity");

        // G2: LP is minted by the change in the invariant, exactly like every
        // other deposit path. Valuing the deposit at its nominal rate paid the
        // depositor for a small, scarce balance that *lowered* D and left the
        // new coin quoted at a premium anyone could sell into. The initial
        // amount therefore has to be large enough to raise D (roughly 4% of the
        // per-coin balance at A = 100); anything smaller reverts.
        uint amp = _A();
        uint d0 = getDMem(_storedRates(), _balances(), amp);
        require(d0 > 0, "Pool has no value");

        // Add coin metadata
        coins.push(Token(_coin));
        assetTypes.push(_assetType);
        if (_assetType == 2) {
            poolContainsRebasingTokens = true;   // G3: see _initialize
        }
        tokenBalances[_coin] = 0;
        adminBalances[_coin] = 0;
        rateMultipliers[_coin] = _rateMultiplier;
        rateOracles[_coin] = PriceOracle(_oracle);

        // Extend internal arrays
        callAmount.push(0);
        scaleFactor.push(0);

        // Transfer in initial deposit (new coin is at index coins.length - 1)
        uint dx = _transferIn(coins.length - 1, _initialAmount, _depositor, false);

        uint[] rates = _storedRates();
        uint[] xp = _xpMem(rates, _balances());
        uint d1 = getD(xp, amp);
        require(d1 > d0, "Initial amount too small: invariant did not increase");
        uint mintAmount = (totalSupply * (d1 - d0)) / d0;
        require(mintAmount > 0, "Deposit too small to mint LP tokens");

        lpToken.mint(_depositor, mintAmount);

        // Seed the new coin's oracle slot at its actual spot price (clamped the
        // way upkeepOracles clamps) rather than a flat 1e18.
        uint[] spot = _getP(xp, amp, d1);
        uint seed = spot[coins.length - 2];
        if (seed == 0) {
            seed = 1e18;
        } else if (seed > 2e18) {
            seed = 2e18;
        }
        lastPricesPacked.push(pack2(seed, seed));

        lastDPacked = pack2(d1, d1);
        uint[2] maLastTimeUnpacked = unpack2(maLastTime);
        if (maLastTimeUnpacked[1] < block.timestamp) {
            maLastTimeUnpacked[1] = block.timestamp;
            maLastTime = pack2(maLastTimeUnpacked[0], maLastTimeUnpacked[1]);
        }

        upkeepOracles(xp, amp, d1);
        _updateRatios(rates, xp, amp, d1);

        emit CoinAdded(_coin, _assetType, _rateMultiplier, _oracle, dx, mintAmount);

        return mintAmount;
    }

    // ============ MIGRATION HELPERS ============

    /// @notice Returns the pool factory address
    function getPoolFactory() external view returns (address) {
        return address(poolFactory);
    }

    /// @notice Returns the number of tokens in the pool
    function getNumCoins() external view returns (uint) {
        return coins.length;
    }

    /// @notice Returns the asset type for a given coin index
    /// @param i The index of the coin
    function getAssetType(uint i) external view returns (uint) {
        require(i < coins.length, "Invalid coin index");
        return assetTypes[i];
    }

    /// @notice Computes the current D invariant of the pool
    /// @return The D invariant value
    function computeInvariant() external view returns (uint) {
        uint amp = _A();
        uint[] rates = _storedRates();
        uint[] balances = _balances();
        uint[] xp = _xpMem(rates, balances);
        return getD(xp, amp);
    }

    /// @notice Migrates all user tokens out of the pool to a receiver
    /// @param receiver The address to receive the tokens
    /// @dev Withdraws admin fees first, then transfers all remaining tokens
    /// @dev Only callable by the pool factory or pool owner
    function migrateAllTokens(address receiver) external onlyPoolFactory {
        require(receiver != address(0), "Cannot migrate to address 0");
        require(!isDisabled, "Pool has already been migrated");
        _withdrawAdminFees();

        // _balances() is balanceOf-based on rebasing pools, so the migrated
        // amount is what the pool actually holds; any protocol fee that could
        // not be swept (no collector) travels with the reserves as before.
        uint[] balances = _balances();
        uint[] amounts;
        for (uint i = 0; i < coins.length; i++) {
            address tokenAddr = address(coins[i]);
            uint balance = balances[i] + adminBalances[tokenAddr];
            amounts.push(balance);
            if (balance > 0) {
                _transferOut(i, balance, receiver);
            }
        }

        // F8: the LP supply is deliberately left standing so the factory can read
        // holder balances while re-minting on the destination pool. Lock the pool
        // so nothing can trade or withdraw against an emptied reserve in the
        // meantime, and put the drain on-chain next to the supply it orphaned.
        isPaused = true;
        isDisabled = true;

        emit TokensMigrated(receiver, amounts, lpToken.totalSupply());
    }

    /// @notice Syncs internal pool state after tokens have been transferred in via migration
    /// @dev Updates tokenBalances from actual ERC20 balances and initializes oracle state
    /// @dev Only callable by the pool factory or pool owner
    function syncAfterMigration() external onlyPoolFactory {
        for (uint i = 0; i < coins.length; i++) {
            adminBalances[address(coins[i])] = 0;
        }
        for (uint i = 0; i < coins.length; i++) {
            address tokenAddr = address(coins[i]);
            uint balance = ERC20(tokenAddr).balanceOf(address(this));
            tokenBalances[tokenAddr] = balance;
            if (i == 0) tokenABalance = balance;
            else if (i == 1) tokenBBalance = balance;
        }

        uint amp = _A();
        uint[] rates = _storedRates();
        uint[] balances = _balances();
        uint[] xp = _xpMem(rates, balances);
        uint d = getD(xp, amp);

        lastDPacked = pack2(d, d);
        uint[2] maLastTimeUnpacked = unpack2(maLastTime);
        if (maLastTimeUnpacked[1] < block.timestamp) {
            maLastTimeUnpacked[1] = block.timestamp;
            maLastTime = pack2(maLastTimeUnpacked[0], maLastTimeUnpacked[1]);
        }

        _updateRatios(rates, xp, amp, d);
        upkeepOracles(xp, amp, d);
    }
}