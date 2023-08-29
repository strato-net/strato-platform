{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}

module Blockchain.Strato.Model.UserRegistry 
    (userRegistryContract) where

import                      Data.Text
import                      Text.RawString.QQ

userRegistryContract :: Text
userRegistryContract = [r|
contract UserRegistry {
    // The UserRegistry is responsible for creating User contracts for each user.
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function createUser(string _commonName, string _userAddress, address _certificateAddress) public returns (address) { 
        require((msg.sender == owner), "You don't have permission to use this function!");

        User newUser = new User{salt: _commonName}();
        newUser.initializeUser(_commonName, address(_userAddress), _certificateAddress);
        return address(newUser);
    }

    function addCertificateToUser(address _userContractAddress, address _certificateAddress) public {
        require((msg.sender == owner), "You don't have permission to use this function!");

        User targetUser = User(_userContractAddress);
        targetUser.addCertificate(_userContractAddress, _certificateAddress);
    }

    function toggleUserActiveStatus(address _userContractAddress) public {
        require((msg.sender == owner), "You don't have permission to use this function!");

        User targetUser = User(_userContractAddress);
        targetUser.toggleUserActiveStatus();
    }
}

contract User {
    address public owner;

    mapping(address => address) userCertificates;     // Data structure subject to change
    string public commonName;
    bool isActive;

    constructor() {
        owner = msg.sender;
    }

    function initializeUser(string _commonName, address _userAddress, address _certificateAddress) {
        // Only UserRegistry can add new certificates.
        require((msg.sender == owner), "You don't have permission to use this function!");

        commonName = _commonName;
        userCertificates[_userAddress] = _certificateAddress;
        isActive = true;
    }

    function addCertificate(address _userAddress, address _certificateAddress) public {
        // Only UserRegistry can add new certificates.
        require((msg.sender == owner), "You don't have permission to use this function!");
        
        userCertificates[_userAddress] = _certificateAddress;
    }

    function toggleUserActiveStatus() public {
        require((msg.sender == owner), "You don't have permission to use this function!");

        isActive = !isActive;
    }

    // Checks if the caller is indeed the user the wallet belongs to.
    function authenticate() public returns (bool) {
        return userCertificates[msg.sender] != address(0);
    }

    function callContract(address contractToCall, string functionName, variadic args) public returns (variadic) {
        // Only the user that this contract is associated with, can use this function.
        require((authenticate() && isActive), "You don't have permission to use this function!");

        variadic result = address(contractToCall).call(functionName, args);
        return result;
    }
}|]