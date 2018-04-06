contract EnumArray {
  enum Pokemon {
    bulbusaur,
    charmander,
    squirtle
  }

  Pokemon[] val;

  function EnumTest() {
    val  = [Pokemon.bulbusaur, Pokemon.squirtle];
  }

  function set(Pokemon[] newvar) {
      val = newvar;
  }

  function get() returns(Pokemon[]) {
      return val;
  }
}
