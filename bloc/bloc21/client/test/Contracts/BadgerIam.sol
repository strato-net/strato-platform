contract Owned {
  address public owner;
  modifier onlyOwner() { if (isOwner(msg.sender)) _}
  modifier ifOwner(address sender) { if(isOwner(sender)) _}

  function Owned(){
      owner = msg.sender;
  }

  function isOwner(address addr) public returns(bool) { return addr == owner; }

  function transfer(address _owner) onlyOwner {
      owner = _owner;
  }
}
contract ReadPermissioned is Owned {
  
  mapping(address => bool) readers;
  modifier onlyReader() { if (isReader(msg.sender)) _ }

  event AddReader(address owner, address reader);

  function addReader(address reader) onlyOwner {
    AddReader(owner, reader);
    readers[reader] = true;
  }

  function isReader(address reader) public returns(bool){
    return readers[reader];
  }
}
contract StorageBlob is ReadPermissioned {

  address public userOwner;
  address public author;
  bytes32[] public tags;
  bytes32 public hash;
  string private contents;

  function StorageBlob(address _userOwner, address _author, bytes32 _hash, bytes32[] _tags, string _contents) {
    userOwner = _userOwner;
    author = _author;
    hash = _hash;
    tags = _tags;
    contents = _contents;
  }

  function getContents() onlyReader returns(string) {
    return contents;
  }
}
contract BasicUserStorage is Owned {

  mapping(bytes32 => address) public userStorage;
  address public user;

  event Stored(
      address ownerKey,
      address author,
      bytes32 ref,
      bytes32[] tags,
      string blobData
  );

  function BasicUserStorage(address _user) {
    user = _user;
  }

  function writeDataToStorage(address _author, bytes32 _hash, bytes32[] _tags, string _contents) returns (bytes32) {
    StorageBlob newBlob = new StorageBlob(user, _author, _hash, _tags, _contents);
    userStorage[_hash] = newBlob;
    Stored(user, _author, _hash, _tags, _contents);
    newBlob.addReader(user);
    newBlob.addReader(_author);
    newBlob.addReader(owner);
    newBlob.transfer(owner);
    return _hash;
  }

  function getStorageBlob(bytes32 _hash) public returns(address) {
    return userStorage[_hash];
  }

  function giveReadPermission(address _newReader, bytes32 _hash) returns(bool success) {
    if (msg.sender == user || msg.sender == owner) {
      StorageBlob blob = StorageBlob(userStorage[_hash]);
      blob.addReader(_newReader);
      return true;
    } else {
      return true;
    }
  }
}
contract Login is Owned {
  mapping (address => uint) public lastLogins;

  event LoggedIn(
    address user,
    address application,
    uint timestamp
  );

  function loginToApp(address application) onlyOwner returns(address) {
    uint timestamp = now;
    lastLogins[application] = timestamp;
    LoggedIn(msg.sender, application, timestamp);
    return application;
  }
}
contract IdentityAccessManager is Owned {

  mapping (address => address) public userToStore;

  event IdentityCreated(
    address userKey,
    address newStore
  );

  event LoginCreated(
    address user,
    address loginAddress
  );


  function createIdentityAgent(address userKey) onlyOwner returns(address[2]) {
    BasicUserStorage store = new BasicUserStorage(userKey);
    IdentityCreated(userKey, store);
    userToStore[userKey] = address(store);
    Login login = new Login();
    login.transfer(userKey);
    LoginCreated(userKey, login);
    return [address(store), address(login)];
  }
}
