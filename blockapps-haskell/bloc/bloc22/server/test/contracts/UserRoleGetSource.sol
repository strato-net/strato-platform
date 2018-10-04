contract UserRole {

    enum UserRole {
      NULL,
      ADMIN,
      BUYER,
      SUPPLIER
    }
    function __getContractName__() view returns (string) {
        return "UserRole";
    }
    function __getSource__() view public returns (string) {
        return "contract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}";
    }
}
