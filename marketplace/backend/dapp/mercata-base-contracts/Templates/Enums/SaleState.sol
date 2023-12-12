import <509>;

pragma es6;
pragma strict;

contract SaleState{
 enum SaleState {
        NONE,
        Created,
        Closed,
        Canceled,
        MAX
    }
}