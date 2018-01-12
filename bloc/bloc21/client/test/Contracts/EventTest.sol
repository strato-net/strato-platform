
contract EventTest {
  event Thing (
    string aMessage
    );

  function EventTest() {
    Thing("a message");
  }

}