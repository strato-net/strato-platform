contract EnumTest {
  enum Pokemon {
    bulbusaur,
    charmander,
    squirtle
  }

  Pokemon val;


  function EnumTest(Pokemon value) {
      val = value;
  }

  function set(Pokemon newvar) {
      val = newvar;
  }

  function get() returns(Pokemon) {
      return val;
  }
}
