// SPDX-License-Identifier: MIT

import "../ERC20/ERC20.sol";

//Removed deadlineCheck for now
//Removed slippage protection as it is pbft
abstract contract Pool is ERC20 {
    // Events
    event TokenPurchase(address buyer, uint256 stable_sold, uint256 tokens_bought);
    event StablePurchase(address buyer, uint256 tokens_sold, uint256 stable_bought);
    event AddLiquidity(address provider, uint256 stable_amount, uint256 token_amount);
    event RemoveLiquidity(address provider, uint256 stable_amount, uint256 token_amount);

    ERC20 public token;                             // ERC20 token traded on this contract
    ERC20 public stablecoin;                        // Stablecoin traded on this contract

    bool private locked;
    
    modifier nonReentrant() {
        require(!locked, "REENTRANT");
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address tokenAddr, 
        address stablecoinAddr
    ) ERC20("Simple LP", "SLP") {
        token = ERC20(tokenAddr);
        stablecoin = ERC20(stablecoinAddr);
    }

    // Core functions
    function addLiquidity(
        uint256 stable_amount,
        uint256 max_tokens
    ) external returns (uint256) {
        require(stable_amount > 0 && max_tokens > 0, "Invalid inputs");
        uint256 total_liquidity = totalSupply();
        
        if (total_liquidity > 0) {
            require(stable_amount > 0, "Min liquidity required");
            uint256 stable_reserve = stablecoin.balanceOf(address(this));
            uint256 token_reserve = token.balanceOf(address(this));
            uint256 token_amount = (stable_amount * token_reserve / stable_reserve) + 1;
            uint256 liquidity_minted = stable_amount * total_liquidity / stable_reserve;
            
            require(max_tokens >= token_amount, "Insufficient token amount");
            _mint(msg.sender, liquidity_minted);
            
            require(stablecoin.transferFrom(msg.sender, address(this), stable_amount), "Stable transfer failed");
            require(token.transferFrom(msg.sender, address(this), token_amount), "Token transfer failed");
            
            emit AddLiquidity(msg.sender, stable_amount, token_amount);
            emit Transfer(address(0), msg.sender, liquidity_minted);
            return liquidity_minted;
        } else {
            require(stable_amount >= 1000000000, "Minimum liquidity required");
            
            uint256 token_amount = max_tokens;
            uint256 initial_liquidity = stable_amount;
            _mint(msg.sender, initial_liquidity);
            
            require(stablecoin.transferFrom(msg.sender, address(this), stable_amount), "Stable transfer failed");
            require(token.transferFrom(msg.sender, address(this), token_amount), "Token transfer failed");
            
            emit AddLiquidity(msg.sender, stable_amount, token_amount);
            emit Transfer(address(0), msg.sender, initial_liquidity);
            return initial_liquidity;
        }
    }

    function removeLiquidity(
        uint256 amount,
        uint256 min_stable,
        uint256 min_tokens
    ) external returns (uint256, uint256) {
        require(amount > 0 && min_stable > 0 && min_tokens > 0, "Invalid inputs");
        uint256 total_liquidity = totalSupply();
        require(total_liquidity > 0, "No liquidity");
        uint256 token_reserve = token.balanceOf(address(this));
        uint256 stable_reserve = stablecoin.balanceOf(address(this));
        uint256 stable_amount = amount * stable_reserve / total_liquidity;
        uint256 token_amount = amount * token_reserve / total_liquidity;
        
        require(stable_amount >= min_stable && token_amount >= min_tokens, "Insufficient amounts");
        
        require(stablecoin.transfer(msg.sender, stable_amount), "Stable transfer failed");
        require(token.transfer(msg.sender, token_amount), "Token transfer failed");
        
        emit RemoveLiquidity(msg.sender, stable_amount, token_amount);
        emit Transfer(msg.sender, address(0), amount);
        
        _burn(msg.sender, amount);
        
        return (stable_amount, token_amount);
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
    function getStableToTokenInputPrice(uint256 stable_sold) external view returns (uint256) {
        require(stable_sold > 0, "Invalid stable amount");
        uint256 token_reserve = token.balanceOf(address(this));
        uint256 stable_reserve = stablecoin.balanceOf(address(this));
        return getInputPrice(stable_sold, stable_reserve, token_reserve);
    }

    function getStableToTokenOutputPrice(uint256 tokens_bought) external view returns (uint256) {
        require(tokens_bought > 0, "Invalid token amount");
        uint256 token_reserve = token.balanceOf(address(this));
        uint256 stable_reserve = stablecoin.balanceOf(address(this));
        return getOutputPrice(tokens_bought, stable_reserve, token_reserve);
    }

    function getTokenToStableInputPrice(uint256 tokens_sold) external view returns (uint256) {
        require(tokens_sold > 0, "Invalid token amount");
        uint256 token_reserve = token.balanceOf(address(this));
        uint256 stable_reserve = stablecoin.balanceOf(address(this));
        return getInputPrice(tokens_sold, token_reserve, stable_reserve);
    }

    function getTokenToStableOutputPrice(uint256 stable_bought) external view returns (uint256) {
        require(stable_bought > 0, "Invalid stable amount");
        uint256 token_reserve = token.balanceOf(address(this));
        uint256 stable_reserve = stablecoin.balanceOf(address(this));
        return getOutputPrice(stable_bought, token_reserve, stable_reserve);
    }

    // Price view functions
    function getCurrentTokenPrice() external view returns (decimal) {
        decimal token_reserve = decimal(token.balanceOf(address(this)));
        decimal stable_reserve = decimal(stablecoin.balanceOf(address(this)));
        require(token_reserve > 0.000000000000000000 && stable_reserve > 0.000000000000000000, "No liquidity");
        // Price of 1 token in stablecoins (stable_reserve / token_reserve)
        return decimal((stable_reserve * 1000000000000000000.000000) / token_reserve) / 1000000000000000000.000000;MERCATA_COMPATIBILITY: Added decimal division for my testing
    }

    function getCurrentStablePrice() external view returns (decimal) {
        decimal token_reserve = decimal(token.balanceOf(address(this)))* 1000000000000000000.000000;
        decimal stable_reserve = decimal(stablecoin.balanceOf(address(this)))* 1000000000000000000.000000;
        require(token_reserve > 0.000000000000000000 && stable_reserve > 0.000000000000000000, "No liquidity");
        // Price of 1 stablecoin in tokens (token_reserve / stable_reserve)
        return decimal((token_reserve * 1000000000000000000.000000) / stable_reserve) / 1000000000000000000.000000; //MERCATA_COMPATIBILITY: Added decimal division for my testing
    }

    // Swap functions
    function stableToToken(
        uint256 stable_sold,
        uint256 min_tokens  
    ) external nonReentrant returns (uint256) {
        require(stable_sold > 0 && min_tokens > 0, "Invalid inputs");
        uint256 token_reserve = token.balanceOf(address(this));
        uint256 stable_reserve = stablecoin.balanceOf(address(this));
        uint256 tokens_bought = getInputPrice(stable_sold, stable_reserve, token_reserve);
        
        require(tokens_bought >= min_tokens, "Insufficient output amount");
        
        require(stablecoin.transferFrom(msg.sender, address(this), stable_sold), "Stable transfer failed");
        require(token.transfer(msg.sender, tokens_bought), "Token transfer failed");
        
        emit TokenPurchase(msg.sender, stable_sold, tokens_bought);
        return tokens_bought;
    }

    function tokenToStable(
        uint256 tokens_sold,
        uint256 min_stable
    ) external nonReentrant returns (uint256) {
        require(tokens_sold > 0 && min_stable > 0, "Invalid inputs");
        uint256 token_reserve = token.balanceOf(address(this));
        uint256 stable_reserve = stablecoin.balanceOf(address(this));
        uint256 stable_bought = getInputPrice(tokens_sold, token_reserve, stable_reserve);
        
        require(stable_bought >= min_stable, "Insufficient output amount");
        
        require(token.transferFrom(msg.sender, address(this), tokens_sold), "Token transfer failed");
        require(stablecoin.transfer(msg.sender, stable_bought), "Stable transfer failed");
        
        emit StablePurchase(msg.sender, tokens_sold, stable_bought);
        return stable_bought;
    }
}
