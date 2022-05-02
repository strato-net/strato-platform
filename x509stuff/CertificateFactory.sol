pragma solidvm 3.2;
contract Certificate {
    address owner;  // The CertificateRegistery Contract

    account certificateHolder;

    // Store all the fields of a certificate in a Cirrus record
    string commonName;
    string country;
    string organization;
    string group;
    string publicKey;
    string certificateString;

    constructor(account _newAccount, string _certificateString) {
        owner = msg.sender;

        certificateHolder = _newAccount;

        mapping(string => string) parsedCert = parseCert(_certificateString);
        commonName = parsedCert["commonName"];
        organization = parsedCert["organization"];
        group = parsedCert["group"];
        publicKey = parsedCert["publicKey"];
        certificateString = parsedCert["certString"];
    }
}

pragma solidvm 3.2;
contract CertificateFactory {
    // The factory maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    Certificate[] certificates;
    mapping(account => uint) certificatesMap;

    string rootPublicKey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
    
    constructor() {
        // Disallow the creation of the CertificateFactory on private chains
        require(account(this, "self").chainId == 0, "The CertificateFactory must be posted on the main chain!");
    }
    
    function createCertificate(account newAccount, string newCertificateString) returns (int) {
        // Verify that the certificate was created by BlockApps (Is this nessesary, registerCert 
        // checks for the BlockApps public key already [I think Troy wants that behavior changed])
        require(verifyCert(newCertificateString, rootPublicKey));

        // Create the new certificate record
        Certificate c = new Certificate(newAccount, newCertificateString);
        certificates.push(c);
        certificatesMap[newAccount] = certificates.length;

        // Register the certificate into LevelDB
        registerCert(newCertificateString);
        return 200; // 200 = HTTP Status OK
    }
}