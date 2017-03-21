contract SimpleStringStorage {
  string key;
  uint value;
  function SimpleStringStorage(string _key, uint _value) {
    key = _key;
    value = _value;
  }

  function setValue(uint _value) {
    value = _value;
  }
}
