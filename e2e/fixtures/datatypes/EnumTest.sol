contract EnumTest {
  enum Pokemon {
    bulbusaur,
    charmander,
    squirtle
  }

  Pokemon val;

  /*mapping (uint => uint) numToNum;*/

  function EnumTest(Pokemon value) {
      val = value;
  }

  /*function EnumTest() {
        val = Pokemon.bulbusaur;
    }*/

  function set(Pokemon newvar) {
      val = newvar;
  }

  function get() returns(Pokemon) {
      return val;
  }
}
