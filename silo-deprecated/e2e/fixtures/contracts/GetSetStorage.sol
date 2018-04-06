contract GetSetStorage {
  int x;
  function set() {x = 1;}
  function get() returns (int) {return x;}
}
