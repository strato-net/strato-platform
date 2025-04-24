// SPDX-License-Identifier: MIT

import "../ERC20/ERC20.sol";

//Removed deadlineCheck for now
//Removed slippage protection as it is pbft
abstract contract Pool is ERC20 {
    
    // Events
    event TokenAPurchase(address buyer, uint256 tokenB_sold, uint256 tokens_bought);
    event TokenBPurchase(address buyer, uint256 tokenA_sold, uint256 tokenB_bought);
    event AddLiquidity(address provider, uint256 tokenB_amount, uint256 tokenA_amount);
    event RemoveLiquidity(address provider, uint256 tokenB_amount, uint256 tokenA_amount);

    ERC20 public tokenA;                             // ERC20 tokenA traded on this contract
    ERC20 public tokenB;                        // Stablecoin traded on this contract

    bool private locked;


    
    modifier nonReentrant() {
        require(!locked, "REENTRANT");
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address tokenAAddr, 
        address tokenBAddr
    ) {
        tokenA = ERC20(tokenAAddr);
        tokenB = ERC20(tokenBAddr);
    }

    // Core functions
    function addLiquidity(
        uint256 tokenB_amount,
        uint256 max_tokens
    ) external returns (uint256) {
        require(tokenB_amount > 0 && max_tokens > 0, "Invalid inputs");
        uint256 total_liquidity = totalSupply();
        
        if (total_liquidity > 0) {
            require(tokenB_amount > 0, "Min liquidity required");
            uint256 tokenB_reserve = tokenB.balanceOf(address(this));
            uint256 tokenA_reserve = tokenA.balanceOf(address(this));
            uint256 tokenA_amount = (tokenB_amount * tokenA_reserve / tokenB_reserve) + 1;
            uint256 liquidity_minted = tokenB_amount * total_liquidity / tokenB_reserve;
            
            require(max_tokens >= tokenA_amount, "Insufficient tokenA amount");
            _mint(msg.sender, liquidity_minted);
            
            require(tokenB.transferFrom(msg.sender, address(this), tokenB_amount), "TokenB transfer failed");
            require(tokenA.transferFrom(msg.sender, address(this), tokenA_amount), "TokenA transfer failed");
            
            emit AddLiquidity(msg.sender, tokenB_amount, tokenA_amount);
            emit Transfer(address(0), msg.sender, liquidity_minted);
            return liquidity_minted;
        } else {
            require(tokenB_amount >= 1000000000, "Minimum liquidity required");
            
            uint256 tokenA_amount = max_tokens;
            uint256 initial_liquidity = tokenB_amount;
            _mint(msg.sender, initial_liquidity);
            
            require(tokenB.transferFrom(msg.sender, address(this), tokenB_amount), "TokenB transfer failed");
            require(tokenA.transferFrom(msg.sender, address(this), tokenA_amount), "TokenA transfer failed");
            
            emit AddLiquidity(msg.sender, tokenB_amount, tokenA_amount);
            emit Transfer(address(0), msg.sender, initial_liquidity);
            return initial_liquidity;
        }
    }

    function removeLiquidity(
        uint256 amount,
        uint256 min_tokenB,
        uint256 min_tokens
    ) external returns (uint256, uint256) {
        require(amount > 0 && min_tokenB > 0 && min_tokens > 0, "Invalid inputs");
        uint256 total_liquidity = totalSupply();
        require(total_liquidity > 0, "No liquidity");
        uint256 tokenA_reserve = tokenA.balanceOf(address(this));
        uint256 tokenB_reserve = tokenB.balanceOf(address(this));
        uint256 tokenB_amount = amount * tokenB_reserve / total_liquidity;
        uint256 tokenA_amount = amount * tokenA_reserve / total_liquidity;
        
        require(tokenB_amount >= min_tokenB && tokenA_amount >= min_tokens, "Insufficient amounts");
        
        require(tokenB.transfer(msg.sender, tokenB_amount), "TokenB transfer failed");
        require(tokenA.transfer(msg.sender, tokenA_amount), "TokenA transfer failed");
        
        emit RemoveLiquidity(msg.sender, tokenB_amount, tokenA_amount);
        emit Transfer(msg.sender, address(0), amount);
        
        _burn(msg.sender, amount);
        
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

    function getOutputPrice(
        uint256 output_amount,
        uint256 input_reserve,
        uint256 output_reserve
    ) pure returns (uint256) {
        require(input_reserve > 0 && output_reserve > 0, "Invalid reserves");
        require(output_reserve > output_amount, "Invalid output amount");
        uint256 numerator = input_reserve * output_amount * 1000;
        uint256 denominator = (output_reserve - output_amount) *  1000;
        return (numerator / denominator) + 1;
    }

    // Public price functions
    function getTokenBToTokenAInputPrice(uint256 tokenB_sold) external view returns (uint256) {
        require(tokenB_sold > 0, "Invalid stable amount");
        uint256 tokenA_reserve = tokenA.balanceOf(address(this));
        uint256 tokenB_reserve = tokenB.balanceOf(address(this));
        return getInputPrice(tokenB_sold, tokenB_reserve, tokenA_reserve);
    }

    function getTokenBToTokenAOutputPrice(uint256 tokens_bought) external view returns (uint256) {
        require(tokens_bought > 0, "Invalid tokenA amount");
        uint256 tokenA_reserve = tokenA.balanceOf(address(this));
        uint256 tokenB_reserve = tokenB.balanceOf(address(this));
        return getOutputPrice(tokens_bought, tokenB_reserve, tokenA_reserve);
    }

    function getTokenAToTokenBInputPrice(uint256 tokenA_sold) external view returns (uint256) {
        require(tokenA_sold > 0, "Invalid tokenA amount");
        uint256 tokenA_reserve = tokenA.balanceOf(address(this));
        uint256 tokenB_reserve = tokenB.balanceOf(address(this));
        return getInputPrice(tokenA_sold, tokenA_reserve, tokenB_reserve);
    }

    function getTokenAToTokenBOutputPrice(uint256 tokenB_bought) external view returns (uint256) {
        require(tokenB_bought > 0, "Invalid stable amount");
        uint256 tokenA_reserve = tokenA.balanceOf(address(this));
        uint256 tokenB_reserve = tokenB.balanceOf(address(this));
        return getOutputPrice(tokenB_bought, tokenA_reserve, tokenB_reserve);
    }

    // Price view functions
    function getCurrentTokenAPrice() external view returns (decimal) {
        decimal tokenA_reserve = decimal(tokenA.balanceOf(address(this)));
        decimal tokenB_reserve = decimal(tokenB.balanceOf(address(this)));
        require(tokenA_reserve > 0.000000000000000000 && tokenB_reserve > 0.000000000000000000, "No liquidity");
        // Price of 1 tokenA in stablecoins (tokenB_reserve / tokenA_reserve)
        return decimal((tokenB_reserve * 1000000000000000000.000000) / tokenA_reserve) / 1000000000000000000.000000;//MERCATA_COMPATIBILITY: Added decimal division for my testing
    }

    function getCurrentTokenBPrice() external view returns (decimal) {
        decimal tokenA_reserve = decimal(tokenA.balanceOf(address(this)))* 1000000000000000000.000000;
        decimal tokenB_reserve = decimal(tokenB.balanceOf(address(this)))* 1000000000000000000.000000;
        require(tokenA_reserve > 0.000000000000000000 && tokenB_reserve > 0.000000000000000000, "No liquidity");
        // Price of 1 tokenB in tokens (tokenA_reserve / tokenB_reserve)
        return decimal((tokenA_reserve * 1000000000000000000.000000) / tokenB_reserve) / 1000000000000000000.000000; //MERCATA_COMPATIBILITY: Added decimal division for my testing
    }

    // Swap functions
    function tokenBToTokenA(
        uint256 tokenB_sold,
        uint256 min_tokens  
    ) external nonReentrant returns (uint256) {
        require(tokenB_sold > 0 && min_tokens > 0, "Invalid inputs");
        uint256 tokenA_reserve = tokenA.balanceOf(address(this));
        uint256 tokenB_reserve = tokenB.balanceOf(address(this));
        uint256 tokens_bought = getInputPrice(tokenB_sold, tokenB_reserve, tokenA_reserve);
        
        require(tokens_bought >= min_tokens, "Insufficient output amount");
        
        require(tokenB.transferFrom(msg.sender, address(this), tokenB_sold), "TokenB transfer failed");
        require(tokenA.transfer(msg.sender, tokens_bought), "TokenA transfer failed");
        
        emit TokenAPurchase(msg.sender, tokenB_sold, tokens_bought);
        return tokens_bought;
    }

    function tokenAToTokenB(
        uint256 tokenA_sold,
        uint256 min_tokenB
    ) external nonReentrant returns (uint256) {
        require(tokenA_sold > 0 && min_tokenB > 0, "Invalid inputs");
        uint256 tokenA_reserve = tokenA.balanceOf(address(this));
        uint256 tokenB_reserve = tokenB.balanceOf(address(this));
        uint256 tokenB_bought = getInputPrice(tokenA_sold, tokenA_reserve, tokenB_reserve);
        
        require(tokenB_bought >= min_tokenB, "Insufficient output amount");
        
        require(tokenA.transferFrom(msg.sender, address(this), tokenA_sold), "TokenA transfer failed");
        require(tokenB.transfer(msg.sender, tokenB_bought), "TokenB transfer failed");
        
        emit TokenBPurchase(msg.sender, tokenA_sold, tokenB_bought);
        return tokenB_bought;
    }
}
