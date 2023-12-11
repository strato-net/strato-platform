import <509>;

pragma es6;
pragma strict;

contract ItemStatus{
  enum ItemStatus{
    NULL,
    PUBLISHED,
    UNPUBLISHED,
    REMOVED,
    SOLD,
    MAX
  }
}
