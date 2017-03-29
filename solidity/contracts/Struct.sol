
contract Struct {

  enum Animals {Dog, Cat, Pig}

  struct Pet {
    Animals animal;
    string name;
    int8 age;
    bool fleasAndTicks;
    }

  Pet sammy = Pet(Animals.Dog, "Sammy", 4, false);


}
  