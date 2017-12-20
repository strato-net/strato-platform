contract UserRole {

    enum UserRole {
        NULL,
        ADMIN,
        BUYER,
        SUPPLIER
    }

    function  __getSource__() constant returns (string) {
        return "contract UserRole {    enum UserRole {        NULL,        ADMIN,        BUYER,        SUPPLIER    }}";
  }
}