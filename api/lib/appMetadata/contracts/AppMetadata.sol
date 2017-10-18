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
  string public url;
  string public description;

  function AppMetadata( string _appName, string _maintainer, string _url
                        , string _version, string _description ) {
    appName = _appName;
    maintainer = _maintainer;
    version = _version;
    url = _url;
    description = _description;
    owner = msg.sender;
  }

  function update( string _appName, string _version, string _maintainer
                   , string _url, string _description ) onlyOwner {
    appName = _appName;
    maintainer = _maintainer;
    version = _version;
    url = _url;
    description = _description;
  }

}
