contract Child {
  string myParent = "";
  function Child(string who){
     myParent = who;
  }
  function test() returns (string retVal) {
      return "Child";
  }

}
