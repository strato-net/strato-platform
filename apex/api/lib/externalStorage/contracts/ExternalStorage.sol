pragma solidity ^0.4.8;

contract ExternalStorage {
    string public uri;
    string public host;
    string public tempHash;
    address[] public signers;
    uint public timeStamp;
    string public metadata;

    function ExternalStorage(string _uri, string _host, string _hash, string _metadata) public {
        uri = _uri;
        host = _host;
        tempHash = _hash;
        signers = [msg.sender];
        metadata = _metadata;
        timeStamp = now;
    }

    function attest() public returns(address[]) {
        signers.push(msg.sender);
        return(signers);
    }
}