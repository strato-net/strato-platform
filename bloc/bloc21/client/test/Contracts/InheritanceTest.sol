
contract Parent1 {
  enum Pets {
    Dog,
    Cat
  }
  int parent1Int=4;
  function parent1Function(string x) {
  }
}

contract Parent2 {
  int parent2Int=5;
  function parent2Function(int x) {
  }
}

contract InheritanceTest is Parent1, Parent2 {
  int childInt=6;
  function childFunction(int x, Pets pet) {
  }
}