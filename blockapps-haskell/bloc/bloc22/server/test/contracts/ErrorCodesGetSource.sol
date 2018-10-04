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
    function __getContractName__() view returns (string) {
        return "ErrorCodes";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n";
    }
}
