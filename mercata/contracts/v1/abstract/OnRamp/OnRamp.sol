pragma es6;
pragma strict;

import <509>;

import "../ERC20/IERC20.sol";
import "../Lending/PriceOracleBase.sol";

abstract contract OnRamp {
    struct SellOrder {
        uint256 id;
        address token;
        address seller;
        uint256 amount;
        uint256 marginBps; // e.g. 500 = +5%
        bool cancelled;
    }

    struct Reservation {
        uint256 amount;
        uint256 timestamp;
    }

    PriceOracleBase public priceOracle;
    uint256 public nextOrderId;
    address public owner;
    address public approver;

    uint256 public RESERVATION_EXPIRY = 1800; // 30 minutes in seconds
    uint256 public MAX_RESERVATIONS_PER_ORDER = 100;

    mapping(uint256 => uint256) public reservationCounts;
    mapping(uint256 => mapping(address => Reservation)) public reservations; // orderId => buyer => reservation
    struct ReservationKey {
        uint256 orderId;
        address buyer;
    }
    ReservationKey[] public activeReservations;
    mapping(uint256 => mapping(address => uint256)) public reservationIndex;

    mapping(address => bool) public tokenMeta;
    mapping(address => bool) public approvedSellers;
    mapping(uint256 => SellOrder) public sellOrders;
    mapping(address => uint256) public activeOrderFor;

    event TokenWhitelisted(address token);
    event SellerApproved(address seller, bool approved);
    event OrderCreated(uint256 orderId, address seller, address token, uint256 amount, uint256 margin);
    event OrderUpdated(uint256 orderId, uint256 newAmount, uint256 newMargin);
    event OrderCancelled(uint256 orderId);
    event OrderFulfilled(uint256 orderId, address buyer, uint256 amount, uint256 totalFiat);

    constructor(address _oracle, address _approver) {
        approver = _approver;
        priceOracle = PriceOracleBase(_oracle);
        owner = msg.sender;
    }

    modifier onlyApprovedSeller() {
        require(approvedSellers[msg.sender], "Not approved");
        _;
    }

    modifier onlyWhitelistedToken(address token) {
        require(tokenMeta[token], "Token not allowed");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyApprover() {
        require(msg.sender == approver, "Not approver");
        _;
    }

    function setSellableToken(address token, bool whitelist) external onlyOwner {
        if (whitelist) {
            require(!tokenMeta[token], "Already whitelisted");

            tokenMeta[token] = true;

            emit TokenWhitelisted(token);
        } else {
            require(tokenMeta[token], "Not whitelisted");
            tokenMeta[token] = false;
        }
    }

    function setSellerApproved(address seller, bool approved) external onlyOwner {
        approvedSellers[seller] = approved;
        emit SellerApproved(seller, approved);
    }

    function setReservationExpiry(uint256 newExpiry) external onlyOwner {
        RESERVATION_EXPIRY = newExpiry;
    }

    function setMaxReservationsPerOrder(uint256 newMax) external onlyOwner {
        MAX_RESERVATIONS_PER_ORDER = newMax;
    }

    function setApprover(address newApprover) external onlyOwner {
        approver = newApprover;
    }

    function setPriceOracle(address newOracle) external onlyOwner {
        priceOracle = PriceOracleBase(newOracle);
    }

    function createSellOrder(address token, uint256 amount, uint256 marginBps)
        external onlyApprovedSeller onlyWhitelistedToken(token)
    {
        require(amount > 0, "Zero amount");
        require(marginBps >= 0, "Margin less than 0");

        uint256 existing = activeOrderFor[token];
        require(existing == 0 || sellOrders[existing].cancelled, "Active order exists");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        sellOrders[nextOrderId] = SellOrder(
            nextOrderId,
            token,
            msg.sender,
            amount,
            marginBps,
            false
        );

        activeOrderFor[token] = nextOrderId;
        emit OrderCreated(nextOrderId, msg.sender, token, amount, marginBps);
        nextOrderId++;
    }

    function updateSellOrder(uint256 orderId, uint256 newAmount, uint256 newMargin) external {
        SellOrder order = sellOrders[orderId];
        require(msg.sender == order.seller, "Not seller");
        require(!order.cancelled, "Cancelled");
        require(newAmount > 0, "Zero amount");
        require(newMargin >= 0, "Margin less than 0");

        if (newAmount > order.amount) {
            uint256 delta = newAmount - order.amount;
            require(IERC20(order.token).balanceOf(msg.sender) >= delta, "Insufficient token balance to increase order");
            IERC20(order.token).transferFrom(msg.sender, address(this), delta);
        } else if (newAmount < order.amount) {
            uint256 delta = order.amount - newAmount;
            IERC20(order.token).transfer(msg.sender, delta);
        }

        order.amount = newAmount;
        order.marginBps = newMargin;

        emit OrderUpdated(orderId, newAmount, newMargin);
    }

    function cancelOrder(uint256 orderId) external {
        SellOrder order = sellOrders[orderId];
        require(msg.sender == order.seller, "Not seller");
        require(!order.cancelled, "Already cancelled");

        uint256 remaining = order.amount;
        order.cancelled = true;

        IERC20(order.token).transfer(msg.sender, remaining);

        emit OrderCancelled(orderId);
    }

    function lockTokens(uint256 orderId, uint256 amount) external {
        sweepExpired();
        require(reservationCounts[orderId] < MAX_RESERVATIONS_PER_ORDER, "Too many reservations");
        SellOrder order = sellOrders[orderId];
        require(!order.cancelled, "Cancelled");
        require(amount > 0 && amount <= order.amount, "Invalid amount");
        require(order.amount >= amount, "Not enough available tokens");

        Reservation r = reservations[orderId][msg.sender];
        require(r.amount == 0, "Already reserved");

        reservations[orderId][msg.sender] = Reservation(
            amount,
            block.timestamp
        );
        _addActiveReservation(orderId, msg.sender);
        order.amount -= amount;
    }

    function fulfillPartialOrder(uint256 orderId) external onlyApprover {
        Reservation r = reservations[orderId][msg.sender];
        require(r.amount > 0, "No reservation to fulfill");
        uint256 reservedAmount = r.amount;
        SellOrder order = sellOrders[orderId];

        require(!order.cancelled, "Cancelled");

        IERC20(order.token).transfer(msg.sender, reservedAmount);

        uint256 totalFiat = calculatePrice(order.token, reservedAmount, order.marginBps);
        emit OrderFulfilled(orderId, msg.sender, reservedAmount, totalFiat);

        delete reservations[orderId][msg.sender];
        _removeActiveReservation(orderId, msg.sender);
    }

    // Reservation management helpers
    function _addActiveReservation(uint256 orderId, address buyer) internal {
        activeReservations.push(ReservationKey(orderId, buyer));
        reservationIndex[orderId][buyer] = activeReservations.length; // 1-based index
        reservationCounts[orderId]++;
    }

    function _removeActiveReservation(uint256 orderId, address buyer) internal {
        uint256 idx = reservationIndex[orderId][buyer];
        require(idx > 0, "No active reservation");
        uint256 lastIdx = activeReservations.length;
        ReservationKey last = activeReservations[lastIdx - 1];
        activeReservations[idx - 1] = last;
        reservationIndex[last.orderId][last.buyer] = idx;
        uint len = activeReservations.length;
        activeReservations[len - 1] = ReservationKey(0, address(0));
        activeReservations.length = len - 1;
        delete reservationIndex[orderId][buyer];
        reservationCounts[orderId]--;
    }

    function sweepExpired() public {
        uint256 processed = 0;
        while (processed < MAX_RESERVATIONS_PER_ORDER && activeReservations.length > 0) {
            uint256 idx = activeReservations.length - 1;
            ReservationKey key = activeReservations[idx];
            Reservation r = reservations[key.orderId][key.buyer];
            // Only expire if past expiry
            if (r.amount > 0 && block.timestamp > r.timestamp + RESERVATION_EXPIRY) {
                SellOrder order = sellOrders[key.orderId];
                order.amount += r.amount;
                delete reservations[key.orderId][key.buyer];
                _removeActiveReservation(key.orderId, key.buyer);
                processed++;
            } else {
                break;
            }
        }
    }

    function calculatePrice(address token, uint256 amount, uint256 marginBps) public view returns (uint256) {
        uint256 base = priceOracle.getAssetPrice(token);
        uint256 finalPrice = base + (base * marginBps) / 10000;
        return finalPrice * amount;
    }

    function rescueTokens(address token) external onlyOwner {
        uint256 orderId = activeOrderFor[token];
        require(orderId != 0, "No active order for token");
        SellOrder order = sellOrders[orderId];
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to rescue");
        IERC20(token).transfer(order.seller, balance);
    }
}
