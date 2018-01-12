
contract Struct2 {

  int x = 10;

  struct Pet {
    string animal;
    string name;
    int8 age;
    bool fleasAndTicks;
    }

  Pet sammy = Pet("dog", "Sammy", 4, false);

  string proclamation = "I am the walrus";

  Pet I = Pet("walrus", "Paul", 64, false);

}
  