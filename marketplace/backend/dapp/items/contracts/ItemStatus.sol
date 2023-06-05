 

/// @title A representation of status of an Item
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
