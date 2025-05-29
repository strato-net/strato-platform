contract record PhysicalRedemptionService is RedemptionService, ERC20Burnable, ERC20 {
    address public owner;

    string public serviceName;
    string public imageURL;
    string public redeemText;

    string public serviceURL;
    string public createRedemptionRoute;
    string public outgoingRedemptionsRoute;
    string public incomingRedemptionsRoute;
    string public getRedemptionRoute;
    string public closeRedemptionRoute;
    string public createCustomerAddressRoute;
    string public getCustomerAddressRoute;

    ERC20Burnable public usdst;

    constructor (
        string _serviceName,
        string _imageURL,
        string _redeemText,
        string _serviceURL,
        string _createRedemptionRoute,
        string _outgoingRedemptionsRoute,
        string _incomingRedemptionsRoute,
        string _getRedemptionRoute,
        string _closeRedemptionRoute,
        string _createCustomerAddressRoute,
        string _getCustomerAddressRoute,
        address _token,
        address _usdst,
        address _pool,
        uint256 _initialSpotPrice,
        uint256 _maxRedemptionAmount
    ) public RedemptionService(
        _token,
        _pool,
        _initialSpotPrice,
        _maxRedemptionAmount
    ) {
        isActive = true;

        serviceName = _serviceName;
        imageURL = _imageURL;
        if (_redeemText != "") {
            redeemText = _redeemText;
        } else {
            redeemText = "Redeem";
        }

        serviceURL = _serviceURL;
        createRedemptionRoute = _createRedemptionRoute;
        outgoingRedemptionsRoute = _outgoingRedemptionsRoute;
        incomingRedemptionsRoute = _incomingRedemptionsRoute;
        getRedemptionRoute = _getRedemptionRoute;
        closeRedemptionRoute = _closeRedemptionRoute;
        createCustomerAddressRoute = _createCustomerAddressRoute;
        getCustomerAddressRoute = _getCustomerAddressRoute;

        usdst = ERC20Burnable(_usdst);
    }

    function update(
        string _imageURL
    ,   string _redeemText
    ,   string _serviceURL
    ,   string _createRedemptionRoute
    ,   string _outgoingRedemptionsRoute
    ,   string _incomingRedemptionsRoute
    ,   string _getRedemptionRoute
    ,   string _closeRedemptionRoute
    ,   string _createCustomerAddressRoute
    ,   string _getCustomerAddressRoute
    ,   uint   _scheme
    ) onlyOwner public returns (uint) {
      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        imageURL = _imageURL;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        redeemText = _redeemText;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        serviceURL = _serviceURL;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        createRedemptionRoute = _createRedemptionRoute;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        outgoingRedemptionsRoute = _outgoingRedemptionsRoute;
      }
      if ((_scheme & (1 << 5)) == (1 << 5)) {
        incomingRedemptionsRoute = _incomingRedemptionsRoute;
      }
      if ((_scheme & (1 << 6)) == (1 << 6)) {
        getRedemptionRoute = _getRedemptionRoute;
      }
      if ((_scheme & (1 << 7)) == (1 << 7)) {
        closeRedemptionRoute = _closeRedemptionRoute;
      }
      if ((_scheme & (1 << 8)) == (1 << 8)) {
        createCustomerAddressRoute = _createCustomerAddressRoute;
      }
      if ((_scheme & (1 << 9)) == (1 << 9)) {
        getCustomerAddressRoute = _getCustomerAddressRoute;
      }

      return RestStatus.OK;
    }

    /**
     * @notice Redeem tokens for underlying assets at the spot price
     * @param tokenAmount Amount of tokens to redeem
     * @param baseAddress For crypto assets, the address to receive the native tokens (unused in physical)
     */
    function redeemAtSpot(uint256 tokenAmount, string baseAddress) external override {
        require(isActive, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        // Transfer tokens from user to contract
        require(ERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");
        
        // Burn tokens by sending to a zero addressand emit event for physical redemption processing
        token.transfer(address(0), tokenAmount);
        
        emit Redeemed(msg.sender, tokenAmount);
    }

    /**
     * @notice Sell tokens for USDST at spot price (only for physical assets)
     * @param tokenAmount Amount of tokens to sell
     */
    function sellForSpot(uint256 tokenAmount) external {
        require(isActive, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        uint256 usdcAmount = (tokenAmount * spotPrice) / 1e18;
        
        // Check if pool has enough depth
        require(ERC20(usdst).balanceOf(address(this)) >= usdcAmount, "Insufficient amount of USDST");

        // Execute the fixed price swap
        require(ERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");
        require(ERC20(usdst).transfer(msg.sender, usdcAmount), "USDST transfer failed");

        emit Redeemed(msg.sender, tokenAmount);
    }
}