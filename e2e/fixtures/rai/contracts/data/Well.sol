contract Well {
  string name;
  string wellHeadBUID;
  string boreHoleBUID;

  function Well(string n, string whBuid, string bhBuid) {
    name = n;
    wellHeadBUID = whBuid;
    boreHoleBUID = bhBuid;
  }

  function get() returns (string, string, string) {
    return (name, wellHeadBUID, boreHoleBUID);
  }
}
