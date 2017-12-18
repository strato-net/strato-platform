contract ErrorCodes {

  enum ErrorCodes {
    NULL,
    SUCCESS,
    ERROR,
    NOT_FOUND,
    EXISTS,
    RECURSIVE,
    INSUFFICIENT_BALANCE
  }

  function __getSource__() constant returns (string) {
    return "contract ErrorCodes {  enum ErrorCodes {    NULL,    SUCCESS,    ERROR,    NOT_FOUND,    EXISTS,    RECURSIVE,    INSUFFICIENT_BALANCE  }}";
  }
}
