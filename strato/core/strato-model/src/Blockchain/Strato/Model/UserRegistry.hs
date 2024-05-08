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

enum SellerStatus {
    NULL,
    UNAUTHORIZED,
    PENDING_REVIEW,
    AUTHORIZED
}

contract UserRegistry {
    error userError (string message);
    function createUser(string _commonName) public returns (address) {
        User newUser = new User{salt: _commonName}(_commonName);
        return address(newUser);
    }

    function requestReview(string commonName) public {
        try {
            // derive the address of the user contract w/ the salt (commonName)
            User theUser = User(address(this).derive(commonName, commonName));
            address(theUser).call("requestReview");
        } catch Require {
            throw userError("You must be the owner of the wallet to call this");
        } catch {
            throw userError("No User contract associated with the common name " + commonName + " in this registry");
        }
    }

    function authorizeSeller(string commonName) public {
        try {
            // derive the address of the user contract w/ the salt (commonName)
            User theUser = User(address(this).derive(commonName, commonName));
            address(theUser).call("authorizeSeller");
        } catch Require {
            throw userError("You must be an admin to call this");
        } catch {
            throw userError("No User contract associated with the common name " + commonName + " in this registry");
        }
    }

    function deauthorizeSeller(string commonName) public {
        try {
            // derive the address of the user contract w/ the salt (commonName)
            User theUser = User(address(this).derive(commonName, commonName));
            address(theUser).call("deauthorizeSeller");
        } catch Require {
            throw userError("You must be an admin to call this");
        } catch {
            throw userError("No User contract associated with the common name " + commonName + " in this registry");
        }
    }
}

contract User {
    string public commonName;
    SellerStatus public sellerStatus;

    constructor(string _commonName) {
        commonName = _commonName;
        sellerStatus = SellerStatus.UNAUTHORIZED;
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
        Certificate cert = CertificateRegistry(address(0x509)).getCertByAddress(msg.sender);
        if (address(cert) != address(0)) {
            return cert.commonName() == commonName;
        }
        return false;
    }

    function requestReview() public authenticated {
        require(sellerStatus != SellerStatus.AUTHORIZED, "You are already an authorized seller");
        sellerStatus = SellerStatus.PENDING_REVIEW;
    }
    
    function authorizeSeller() public onlyAdmins {
        sellerStatus = SellerStatus.AUTHORIZED;
    }

    function deauthorizeSeller() public onlyAdmins {
        sellerStatus = SellerStatus.UNAUTHORIZED;
    }
}|]
