contract record mortal {
  address owner;

  function mortal() {
    owner = msg.sender;
  }

  function kill() {
    if (msg.sender == owner)
      selfdestruct(owner);
  }
}