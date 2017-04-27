
contract Parent1 {
  int parent1Int=4;
}

contract Parent2 {
  int parent2Int=5;
}

contract InheritanceTest is Parent1, Parent2 {
  int childInt=6;
}