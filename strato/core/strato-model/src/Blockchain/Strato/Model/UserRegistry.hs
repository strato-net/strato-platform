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

import { Certificate, CertificateRegistry } from <509>;

contract UserRegistry {
    function createUser(string _commonName) public returns (address) {
        User newUser = new User{salt: _commonName}(_commonName);
        return address(newUser);
    }
}

contract User {
    string public commonName;

    constructor(string _commonName) {
        commonName = _commonName;
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
        Certificate cert = CertificateRegistry(address(0x509)).getCertByAddress(msg.sender);
        if (address(cert) != address(0)) {
            return cert.commonName() == commonName;
        }
        return false;
    }
}|]
