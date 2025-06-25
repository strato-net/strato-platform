// SPDX-License-Identifier: MIT
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";

//Removed deadlineCheck for now
//Removed slippage protection as it is pbft
contract record Pool {
    
    // Events
    event TokenAPurchase(address buyer, uint256 tokenB_sold, uint256 tokens_bought);
    event TokenBPurchase(address buyer, uint256 tokenA_sold, uint256 tokenB_bought);
    event AddLiquidity(address provider, uint256 tokenB_amount, uint256 tokenA_amount);
    event RemoveLiquidity(address provider, uint256 tokenB_amount, uint256 tokenA_amount);

    Token public tokenA;
    Token public tokenB;
    Token public lpToken;
    TokenFactory public tokenFactory;

    bool private locked;   
    
    decimal public aToBRatio;
    decimal public bToARatio;

    uint public tokenABalance;
    uint public tokenBBalance;

    // All fee variables are in basis points (bps): 1% = 100 bps, 0.3% = 30 bps, 70% = 7000 bps
    uint256 public swapFeeRate = 30; // 30 bps = 0.3%
    uint256 public lpSharePercent = 7000; // 7000 bps = 70%
    uint256 public protocolSharePercent = 3000; // 3000 bps = 30%
    mapping(address => uint256) public feePerShare;
    mapping(address => uint256) public rewardDebt;
    address public feeCollector;
    
    modifier nonReentrant() {
        require(!locked, "REENTRANT");
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address tokenAAddr, 
        address tokenBAddr,
        address _tokenFactory
    ) {
        require(_tokenFactory != address(0), "Zero token factory address");
        tokenFactory = TokenFactory(_tokenFactory);
        tokenA = Token(tokenAAddr);
        tokenB = Token(tokenBAddr);
        
        // Create LP token through token factory
        string lpName = ERC20(tokenAAddr).name() + "-" + ERC20(tokenBAddr).name() + " LP Token";
        string lpSymbol = ERC20(tokenAAddr).symbol() + "-" + ERC20(tokenBAddr).symbol() + "-LP";
        
        address lpTokenAddress = tokenFactory.createToken(
            lpName,
            "Liquidity Provider Token",
            [],
            [],
            [],
            lpSymbol,
            0,
            18
        );
        
        lpToken = Token(lpTokenAddress);

        feeCollector = msg.sender; // TODO: Make this a parameter
    }

    function updateStateVars() internal {
        aToBRatio = getCurrentTokenABRatio();
        bToARatio = getCurrentTokenBARatio();
        tokenABalance = ERC20(tokenA).balanceOf(address(this));
        tokenBBalance = ERC20(tokenB).balanceOf(address(this));
    }

    // Core functions
    function addLiquidity(
        uint256 tokenB_amount,
        uint256 max_tokenA_amount
    ) external returns (uint256) {
        require(tokenB_amount > 0 && max_tokenA_amount > 0, "Invalid inputs");
        uint256 total_liquidity = ERC20(lpToken).totalSupply();
        
        if (total_liquidity > 0) {
            uint256 tokenB_reserve = ERC20(tokenB).balanceOf(address(this));
            uint256 tokenA_reserve = ERC20(tokenA).balanceOf(address(this));
            uint256 tokenA_amount = (tokenB_amount * tokenA_reserve / tokenB_reserve) + 1;
            uint256 liquidity_minted = tokenB_amount * total_liquidity / tokenB_reserve;

            require(max_tokenA_amount >= tokenA_amount, "Insufficient tokenA amount");
            lpToken.mint(msg.sender, liquidity_minted);
            rewardDebt[msg.sender] = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare[address(lpToken)]) / 1e18;

            require(ERC20(tokenB).transferFrom(msg.sender, address(this), tokenB_amount), "TokenB transfer failed");
            require(ERC20(tokenA).transferFrom(msg.sender, address(this), tokenA_amount), "TokenA transfer failed");

            emit AddLiquidity(msg.sender, tokenB_amount, tokenA_amount);

            updateStateVars();

            return liquidity_minted;
        } else {
            uint256 tokenA_amount = max_tokenA_amount;
            uint256 initial_liquidity = tokenB_amount;
            lpToken.mint(msg.sender, initial_liquidity);
            rewardDebt[msg.sender] = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare[address(lpToken)]) / 1e18;

            require(ERC20(tokenB).transferFrom(msg.sender, address(this), tokenB_amount), "TokenB transfer failed");
            require(ERC20(tokenA).transferFrom(msg.sender, address(this), tokenA_amount), "TokenA transfer failed");

            emit AddLiquidity(msg.sender, tokenB_amount, tokenA_amount);

            updateStateVars();

            return initial_liquidity;
        }
    }

    function removeLiquidity(
        uint256 amount, 
        uint256 min_tokenB,
        uint256 min_tokenA_amount
    ) external returns (uint256, uint256) {
        require(amount > 0 && min_tokenB > 0 && min_tokenA_amount > 0, "Invalid inputs");
        uint256 total_liquidity = ERC20(lpToken).totalSupply();
        require(total_liquidity > 0, "No liquidity");
        uint256 tokenA_reserve = ERC20(tokenA).balanceOf(address(this));
        uint256 tokenB_reserve = ERC20(tokenB).balanceOf(address(this));
        uint256 tokenB_amount = amount * tokenB_reserve / total_liquidity;
        uint256 tokenA_amount = amount * tokenA_reserve / total_liquidity;
        
        require(tokenB_amount >= min_tokenB && tokenA_amount >= min_tokenA_amount, "Insufficient amounts");

        require(ERC20(tokenB).transfer(msg.sender, tokenB_amount), "TokenB transfer failed");
        require(ERC20(tokenA).transfer(msg.sender, tokenA_amount), "TokenA transfer failed");

        emit RemoveLiquidity(msg.sender, tokenB_amount, tokenA_amount);

        lpToken.burn(msg.sender, amount);
        rewardDebt[msg.sender] = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare[address(lpToken)]) / 1e18;

        updateStateVars();

        return (tokenB_amount, tokenA_amount);
    }

    // Private pricing functions
    function getInputPrice(
        uint256 input_amount,
        uint256 input_reserve,
        uint256 output_reserve
    ) pure returns (uint256) {
        require(input_reserve > 0 && output_reserve > 0, "Invalid reserves");
        uint256 input_amount_with_fee = input_amount *  1000;//Mercata_Compatibility: Updated from 997 which would be 0.03% fees
        uint256 numerator = input_amount_with_fee * output_reserve;
        uint256 denominator = (input_reserve * 1000) + input_amount_with_fee;
        return numerator / denominator;
    }

    // Public price functions
    function getTokenAQuantityNeededForTokenBQuantity(uint256 amount, bool isTokenBToTokenA) external view returns (uint256) {
        require(amount > 0, "Invalid stable amount");
        uint256 tokenA_reserve = ERC20(tokenA).balanceOf(address(this));
        uint256 tokenB_reserve = ERC20(tokenB).balanceOf(address(this));

        if (isTokenBToTokenA) {
            return getInputPrice(amount, tokenB_reserve, tokenA_reserve);
        } else {
            return getInputPrice(amount, tokenA_reserve, tokenB_reserve);
        }
    }

    // Price view functions
    function getCurrentTokenABRatio() public view returns (decimal) {
        decimal tokenA_reserve = decimal(ERC20(tokenA).balanceOf(address(this)));
        decimal tokenB_reserve = decimal(ERC20(tokenB).balanceOf(address(this)));
        
        if (tokenA_reserve <= 0.000000000000000000 || tokenB_reserve <= 0.000000000000000000) {
            return 0;
        }
        
        // Price of 1 tokenA in stablecoins (tokenB_reserve / tokenA_reserve)
        return decimal((tokenB_reserve * 1.000000000000000000 ) / tokenA_reserve) / 1.000000000000000000;//MERCATA_COMPATIBILITY: Added decimal division for my testing
    }


    function getCurrentTokenBARatio() public view returns (decimal) {
        decimal tokenA_reserve = decimal(ERC20(tokenA).balanceOf(address(this)))* 1.000000000000000000;
        decimal tokenB_reserve = decimal(ERC20(tokenB).balanceOf(address(this)))* 1.000000000000000000;
        
        if (tokenA_reserve <= 0.000000000000000000 || tokenB_reserve <= 0.000000000000000000) {
            return 0;
        }
        
        // Price of 1 tokenB in tokens (tokenA_reserve / tokenB_reserve)
        return decimal((tokenA_reserve * 1.000000000000000000) / tokenB_reserve) / 1.000000000000000000; //MERCATA_COMPATIBILITY: Added decimal division for my testing
    }

    // Swap functions
    function tokenBToTokenA(
        uint256 tokenB_sold,
        uint256 min_tokens  
    ) external nonReentrant returns (uint256) {
        require(tokenB_sold > 0 && min_tokens > 0, "Invalid inputs");
        uint256 tokenA_reserve = ERC20(tokenA).balanceOf(address(this));
        uint256 tokenB_reserve = ERC20(tokenB).balanceOf(address(this));

        uint256 inputAmount = tokenB_sold;

        // Fee is calculated in basis points: swapFeeRate in bps (e.g., 30 = 0.3%)
        uint256 fee = (inputAmount * swapFeeRate) / 10000; // 10000 bps = 100%
        uint256 lpFee = (fee * lpSharePercent) / 10000;
        uint256 protocolFee = fee - lpFee;

        // Update fee per share
        uint256 totalSupply = ERC20(lpToken).totalSupply();
        if (totalSupply > 0) {
            feePerShare[address(lpToken)] += (lpFee * 1e18) / totalSupply;
        }

        // Send protocol fee to collector
        require(ERC20(tokenB).transferFrom(msg.sender, feeCollector, protocolFee), "Fee transfer failed");

        // Reduce swap amount by total fee
        inputAmount -= fee;

        uint256 tokens_bought = getInputPrice(inputAmount, tokenB_reserve, tokenA_reserve);
        
        require(tokens_bought >= min_tokens, "Insufficient output amount");
        
        require(ERC20(tokenB).transferFrom(msg.sender, address(this), inputAmount), "TokenB transfer failed");
        require(ERC20(tokenA).transfer(msg.sender, tokens_bought), "TokenA transfer failed");
        
        updateStateVars();

        emit TokenAPurchase(msg.sender, tokenB_sold, tokens_bought);
        return tokens_bought;
    }

    function tokenAToTokenB(
        uint256 tokenA_sold,
        uint256 min_tokenB
    ) external nonReentrant returns (uint256) {
        require(tokenA_sold > 0 && min_tokenB > 0, "Invalid inputs");
        uint256 tokenA_reserve = ERC20(tokenA).balanceOf(address(this));
        uint256 tokenB_reserve = ERC20(tokenB).balanceOf(address(this));

        uint256 inputAmount = tokenA_sold;

        // Fee is calculated in basis points: swapFeeRate in bps (e.g., 30 = 0.3%)
        uint256 fee = (inputAmount * swapFeeRate) / 10000; // 10000 bps = 100%
        uint256 lpFee = (fee * lpSharePercent) / 10000;
        uint256 protocolFee = fee - lpFee;

        // Update fee per share
        uint256 totalSupply = ERC20(lpToken).totalSupply();
        if (totalSupply > 0) {
            feePerShare[address(lpToken)] += (lpFee * 1e18) / totalSupply;
        }

        // Send protocol fee to collector
        require(ERC20(tokenA).transferFrom(msg.sender, feeCollector, protocolFee), "Fee transfer failed");

        // Reduce swap amount by total fee
        inputAmount -= fee;

        uint256 tokenB_bought = getInputPrice(inputAmount, tokenA_reserve, tokenB_reserve);
        
        require(tokenB_bought >= min_tokenB, "Insufficient output amount");
        
        require(ERC20(tokenA).transferFrom(msg.sender, address(this), inputAmount), "TokenA transfer failed");
        require(ERC20(tokenB).transfer(msg.sender, tokenB_bought), "TokenB transfer failed");
        
        updateStateVars();
        
        emit TokenBPurchase(msg.sender, tokenA_sold, tokenB_bought);
        return tokenB_bought;
    }

    function claimFees() external {
        uint256 accrued = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare[address(lpToken)]) / 1e18;
        uint256 pending = accrued - rewardDebt[msg.sender];
        rewardDebt[msg.sender] = accrued;

        require(ERC20(tokenA).transfer(msg.sender, pending), "Claim transfer failed");
    }
}
