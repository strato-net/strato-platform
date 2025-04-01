pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract PhysicalRedemptionService is RedemptionService {
    address public owner;
    string public ownerCommonName;

    bool public isActive;

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

    event Redemption (
        string redemptionId,
        Redeemable asset,
        string issuer,
        string owner,
        uint quantity
    );

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
        address _usdcToken,
        address _pool,
        uint256 _initialSpotPrice,
        uint256 _maxRedemptionAmount,
        address _bridge,
        bool _isPhysicalAsset
    ) public RedemptionService(
        _token,
        _usdcToken,
        _pool,
        _initialSpotPrice,
        _maxRedemptionAmount,
        _bridge,
    ) {
                owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

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
    }

    modifier requireOwner(string action) {
        string err = "Only the owner can "
                   + action
                   + ".";
        require(getCommonName(msg.sender) == ownerCommonName, err);
        _;
    }

    modifier requireActive(string action) {
        string err = "The payment service must be active to "
                   + action
                   + ".";
        require(isActive, err);
        _;
    }

    function transferOwnership(address _newOwner) requireOwner("transfer ownership") external {
        owner = _newOwner;
        ownerCommonName = getCommonName(owner);
    }

    function deactivate() requireOwner("deactivate the redemption service") external {
        isActive = false;
    }

    function redemptionRequested (
        string _redemptionId
    ) public {
        Redeemable asset = Redeemable(msg.sender);
        emit Redemption (
            _redemptionId,
            Redeemable(msg.sender),
            msg.sender.creator,
            asset.ownerCommonName(),
            asset.getRedemptionQuantity(msg.sender)
        );
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
    ) requireOwner("update the redemption service") public returns (uint) {
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
    function redeemAtSpot(uint256 tokenAmount, string memory baseAddress) external override {
        require(redemptionsEnabled, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        // Transfer tokens from user to contract
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");
        
        // Burn tokens and emit event for physical redemption processing
        require(token.burn(tokenAmount), "Token burn failed");
        emit Redeemed(msg.sender, tokenAmount);
    }

    /**
     * @notice Sell tokens for USDST at spot price (only for physical assets)
     * @param tokenAmount Amount of tokens to sell
     */
    function sellForSpot(uint256 tokenAmount) external {
        require(redemptionsEnabled, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        uint256 usdcAmount = (tokenAmount * spotPrice) / 1e18;
        
        // Check if pool has enough depth
        require(usdcToken.balanceOf(address(this)) >= usdcAmount, "Insufficient pool depth");

        // Execute the fixed price swap
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");
        require(usdcToken.transfer(msg.sender, usdcAmount), "USDST transfer failed");

        emit Redeemed(msg.sender, tokenAmount, usdcAmount);
    }
}