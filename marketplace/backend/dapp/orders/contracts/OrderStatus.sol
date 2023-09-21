 /// @title A representation of OrderStatus of Order
contract OrderStatus{
    enum OrderStatus{
        NULL,
        AWAITING_FULFILLMENT,
        AWAITING_SHIPMENT,
        CLOSED,
        CANCELED,
        PAYMENT_PENDING,
        MAX
    }
}