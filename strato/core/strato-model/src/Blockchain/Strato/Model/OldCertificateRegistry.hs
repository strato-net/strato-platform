{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.Strato.Model.OldCertificateRegistry (oldCertificateRegistryContract) where

import Data.Text
import Text.RawString.QQ

oldCertificateRegistryContract :: Text
oldCertificateRegistryContract =
  [r|
contract Certificate {
    address owner;  // The CertificateRegistry Contract

    address public userAddress;
    address public parent;
    address[] public children;


    // Store all the fields of a certificate in a Cirrus record
    string public commonName;
    string public country;
    string public organization;
    string public group;
    string public organizationalUnit;
    string public publicKey;
    string public certificateString;
    bool public isValid;

    constructor(string _certificateString) {
        owner = msg.sender;

        mapping(string => string) parsedCert = parseCert(_certificateString);

        userAddress = address(parsedCert["userAddress"]);
        commonName = parsedCert["commonName"];
        organization = parsedCert["organization"];
        group = parsedCert["group"];
        organizationalUnit = parsedCert["organizationalUnit"];
        country = parsedCert["country"];
        publicKey = parsedCert["publicKey"];
        certificateString = parsedCert["certString"];
        isValid = true;
        parent = address(parsedCert["parent"]);
        children = [];
    }

    function addChild(address _child) public {
        require((msg.sender == owner || msg.sender == parent),"You don't have permission to CALL addChild!");

        children.push(_child);
    }

    function revoke() public returns (int){
        require(msg.sender == owner,"You don't have permission to CALL revoke!");

        isValid = false;
        return children.length;
    }

    function getChild(int index) public returns (address){
        require(msg.sender == owner,"You don't have permission to get children!");

        return children[index];
    }
}

contract CertificateRegistry {
    // The registry maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    mapping(address => address) addressToCertMap;
    address public owner;

    event CertificateRegistered(string certificate);
    event CertificateRevoked(address userAddress);

    function registerCertificate(string newCertificateString) returns (int) {
        mapping(string => string) parsedCert = parseCert(newCertificateString);
        address parentUserAddress = address(parsedCert["parent"]);
        Certificate parentContract = Certificate(addressToCertMap[account(parentUserAddress)]);

        if (address(parentContract) != address(0) && parentContract.isValid() && verifyCertSignedBy(newCertificateString, parentContract.publicKey())) {
            // Create the new Certificate record
            Certificate c = new Certificate(newCertificateString);

            if (parentUserAddress != address(0x0)){
                parentContract.addChild(c.userAddress());    
            }

            addressToCertMap[c.userAddress()] = address(c);
            emit CertificateRegistered(newCertificateString);
            return 200; // 200 = HTTP Status OK
        }
        return 400;
    }

    function getUserCert(address _address) returns (Certificate) {
        return Certificate(addressToCertMap[account(_address)]);
    }

    function getCertByAddress(address _address) returns (Certificate) {
        return Certificate(getCertByAccount(account(_address)));
    }

    function getCertByAccount(address _account) returns (Certificate) {
        return Certificate(addressToCertMap[account(_account)]);
    }

    function revokeCert(address userAddress){
        Certificate myCert = Certificate(addressToCertMap[account(userAddress)]);
        require(isChild(tx.certificate, myCert.userAddress()), "You don't have permission to revoke!");

        int childrenLength = myCert.revoke();
        for (int i = 0; i < childrenLength; i += 1) {
            revokeCert(myCert.getChild(i));
        }

        emit CertificateRevoked(userAddress);
    }

    function isChild(string pCert, address certUserAddress) returns (bool) {
        Certificate myCert = Certificate(addressToCertMap[account(certUserAddress)]);
        address parentUserAddress = myCert.parent();
        if(myCert.parent() != address(0x0) && pCert ==  Certificate(addressToCertMap[account(parentUserAddress)]).certificateString()){
            return true;
        }

        if(myCert.parent() != address(0x0)){
            return isChild(pCert, parentUserAddress);
        }

        return false;
    }
}|]