contract test {
     uint constant data = 42;
}
contract complex {
  struct Data { uint a; bytes3 b; mapping(uint => uint) map; }
  mapping(uint => mapping(bool => Data[])) data;
}