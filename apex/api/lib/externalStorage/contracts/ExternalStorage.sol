contract owned {
    function owned() { owner = msg.sender; }
    address owner;

    modifier onlyOwner {
        if (msg.sender != owner)
            throw;
        _;
    }
}

contract ExternalStorage is owned {

    string public uri;
    string public s3path;
    string public hash;
    string public host;
    string public publicKey;
    string public timeStamp;

    function ExternalStorage(string _uri, string _s3path, string _hash, string _host, string _publicKey, string _timeStamp) public {
        uri = _uri;
        s3path = _s3path;
        hash = _hash;
        host = _host;
        publicKey = _publicKey;
        timeStamp = _timeStamp;
        owner = msg.sender;
    }

    function verifyHash(string _hash) public view onlyOwner {
        if (_hash == hash) {
            return true;
        }
    }

    function viewHash() public view onlyOwner returns (string, string, string) {
      // returns the timestamp of the upload and the public key of the uploader. 
        return (timeStamp, publicKey, hash);
    }

}