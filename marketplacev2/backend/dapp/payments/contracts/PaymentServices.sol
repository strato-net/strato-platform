

/// @title A representation of PaymentServices of PaymentProvider
contract PaymentServices{
    enum PaymentServices{
        NULL,
        STRIPE,
        PAYPAL,
        MAX
    }
}