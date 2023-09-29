{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.Strato.Model.CertificateRegistry (certificateRegistryContract) where

import Data.Text
import Text.RawString.QQ

certificateRegistryContract :: Text
certificateRegistryContract =
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

    constructor() {
        owner = msg.sender;
    }

    function initializeCertificate (string _certificateString) {
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
    address public owner;

    event CertificateRegistered(string certificate);
    event CertificateRevoked(address userAddress);

    function registerCertificate(string newCertificateString) returns (int) {
        mapping(string => string) parsedCert = parseCert(newCertificateString);
        string parentUserAddress = parsedCert["parent"];
        address parentCertAddress = address(this).derive(parentUserAddress);
        Certificate parentContract = Certificate(address(parentCertAddress));
        
        if (address(parentContract) != address(0) && parentContract.isValid() && verifyCertSignedBy(newCertificateString, parentContract.publicKey())) {
            // Create the new Certificate record
            string userAddress = parsedCert["userAddress"];
            Certificate c = new Certificate{salt: userAddress}();
            c.initializeCertificate(newCertificateString);

            if (address(parentUserAddress) != address(0x0)){
                parentContract.addChild(c.userAddress());    
            }

            emit CertificateRegistered(newCertificateString);
            return 200; // 200 = HTTP Status OK
        }
        return 400;
    }

    function getUserCert(address _address) returns (Certificate) {
        address certAddress = address(this).derive(string(_address));
        return Certificate(certAddress);
    }
    
    function revokeCert(address userAddress){
        address certAddress = address(this).derive(string(userAddress));
        Certificate myCert = Certificate(certAddress);
        require(isChild(tx.certificate, myCert.userAddress()), "You don't have permission to revoke!");

        int childrenLength = myCert.revoke();
        for (int i = 0; i < childrenLength; i += 1) {
            revokeCert(myCert.getChild(i));
        }
        
        emit CertificateRevoked(userAddress);
    }
    
    function isChild(string pCert, address certUserAddress) returns (bool) {
        address certAddress = address(this).derive(string(certUserAddress));
        Certificate myCert = Certificate(certAddress);
        string parentUserAddress = string(myCert.parent());
        address parentCertAddress = address(this).derive(parentUserAddress);
        if(myCert.parent() != address(0x0) && pCert == Certificate(parentCertAddress).certificateString()){
            return true;
        }
        
        if(myCert.parent() != address(0x0)){
            return isChild(pCert, address(parentUserAddress));
        }
        
        return false;
    }
}|]
