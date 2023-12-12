import <509>;

pragma es6;
pragma strict;

contract PaymentType {
enum PaymentType{
        NONE,
        AMEX,
        Discover,
        Mastercard,
        STRAT,
        VISA,
        MAX
    }
}