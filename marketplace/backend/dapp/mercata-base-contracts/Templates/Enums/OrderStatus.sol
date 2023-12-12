import <509>;

pragma es6;
pragma strict;

contract OrderStatus{
    enum OrderStatus{
        NULL,
        AWAITING_FULFILLMENT,
        AWAITING_SHIPMENT,
        CLOSED,
        CANCELED,
        MAX
    }
}