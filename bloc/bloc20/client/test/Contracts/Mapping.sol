
contract Mapping {

  mapping(int=>string) intToStringMapping;
  mapping(string=>int) stringToIntMapping;

  function Mapping() {
    intToStringMapping[0] = "zero";
    intToStringMapping[1] = "one";

    stringToIntMapping["big"] = 1000;
    stringToIntMapping["small"] = 2;
    }

}