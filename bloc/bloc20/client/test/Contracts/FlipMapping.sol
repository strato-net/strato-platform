
contract FlipMapping {

  mapping(int=>int) flipMapping;

  function FlipMapping() {
    flipMapping[0] = 1;
    flipMapping[1] = 0;
    }

}