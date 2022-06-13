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
    string  public appName;
    string  public version;
    string  public url;
    string  public description;

    function AppMetadata( string _appName, string _version
                        , string _url, string _description ) {
        appName = _appName;
        version = _version;
        url = _url;
        description = _description;
        owner = msg.sender;
    }

    function update( string _appName, string _version
                        , string _url, string _description ) onlyOwner {
        appName = _appName;
        version = _version;
        url = _url;
        description = _description;
        owner = msg.sender;
    }
}