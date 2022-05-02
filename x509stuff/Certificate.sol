pragma solidvm 3.2;
contract Certificate {
    string pemCertificate; // The PEM encoding of the cert
    address subjectAddress;
    string subjectCommonName;
    string subjectOrganization;
    string subjectGroup;
    string subjectPublicKey;
    string subjectCountry;

    constructor(
        address _subjectAddress,
        string _cert
    ) {
        pemCertificate = _cert;
        subjectAddress = _subjectAddress;
        mapping(string => string) parsedCert = parseCert(_cert);
        subjectCommonName = parsedCert["commonName"];
        subjectOrganization = parsedCert["organization"];
        subjectGroup = parsedCert["group"];
        subjectPublicKey = parsedCert["publicKey"];
    }
}