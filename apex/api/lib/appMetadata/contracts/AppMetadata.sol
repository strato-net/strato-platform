contract owned {
  function owned() { owner = msg.sender; }
  address owner;

  modifier onlyOwner {
    if (msg.sender != owner)
      throw;
    _;
  }
}

contract AppMetadata is owned {
  string public appName;
  string public maintainer;
  string public version;
  string public description;
  string public hash;
  string public host;

  function AppMetadata( string _appName, string _maintainer, string _version, string _description, string _hash, string _host ) {
    appName = _appName;
    maintainer = _maintainer;
    version = _version;
    description = _description;
    hash = _hash;
    host = _host;
    owner = msg.sender;
  }

  function update( string _appName, string _version, string _maintainer, string _description, string _hash, string _host ) onlyOwner {
    appName = _appName;
    maintainer = _maintainer;
    version = _version;
    description = _description;
    hash = _hash;
    host = _host;
  }

}
