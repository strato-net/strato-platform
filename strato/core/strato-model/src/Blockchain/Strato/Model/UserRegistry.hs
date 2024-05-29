{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.Strato.Model.UserRegistry (userRegistryContract) where

import Data.Text
import Text.RawString.QQ

userRegistryContract :: Text
userRegistryContract =
  [r|
pragma es6;
pragma strict;
pragma builtinCreates;

enum IssuerStatus {
    NULL,
    UNAUTHORIZED,
    PENDING_REVIEW,
    AUTHORIZED
}

contract UserRegistry {
    function createUser(string _commonName) public returns (address) {
        User newUser = new User{salt: _commonName}(_commonName);
        return address(newUser);
    }
}

contract User {
    string public commonName;
    IssuerStatus public issuerStatus;

    constructor(string _commonName) {
        commonName = _commonName;
        issuerStatus = IssuerStatus.UNAUTHORIZED;
    }

    modifier onlyAdmins() {
        mapping(string => string) cert = getUserCert(msg.sender);
        require(cert["organization"] == "BlockApps");
        _;
    }

    modifier authenticated() {
        // Only the user that this contract is associated with, can use this function.
        require(authenticate(), "You don't have permission to use this function!");
        _;
    }

    function createContract(string contractName, string contractSrc, string args) public authenticated {
        create(contractName, contractSrc, args);
    }

    function createSaltedContract(string salt, string contractName, string contractSrc, string args) public authenticated {
        create2(salt, contractName, contractSrc, args);
    }

    function callContract(address contractToCall, string functionName, variadic args) public returns (variadic) authenticated {
        variadic result = address(contractToCall).call(functionName, args);
        return result;
    }

    // Checks if the caller is indeed the user the wallet belongs to.
    function authenticate() internal returns (bool) {
        mapping (string => string) cert = getUserCert(msg.sender);
        return cert["commonName"] == commonName;
    }

    function requestReview() public authenticated {
        require(issuerStatus != IssuerStatus.AUTHORIZED, "You are already an authorized issuer");
        issuerStatus = IssuerStatus.PENDING_REVIEW;
    }
    
    function authorizeIssuer() public onlyAdmins {
        issuerStatus = IssuerStatus.AUTHORIZED;
    }

    function deauthorizeIssuer() public onlyAdmins {
        issuerStatus = IssuerStatus.UNAUTHORIZED;
    }
}|]
