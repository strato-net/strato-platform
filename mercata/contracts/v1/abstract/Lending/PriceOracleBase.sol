
pragma solidvm 12.0;

abstract contract PriceOracleBase {
   constructor() {
        
    } 
     event PriceUpdated(address indexed asset, uint256 price);

    mapping(address => uint256) public record prices;

     function setAssetPrice(address asset, uint256 price)  {
        require(price > 0, "Invalid price");
        prices[asset] = price;
        emit PriceUpdated(asset, price);
    }

    function getAssetPrice(address asset) view  returns (uint256) {
        uint256 price = prices[asset];
        require(price > 0, "Price not set");
        return price;
    }

}