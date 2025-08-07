{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.GenesisBlocks.Contracts.CertRegistry (
  insertCertRegistryContract,
  certificateRegistryContract
  ) where

import BlockApps.X509.Certificate
import BlockApps.X509.Keys (pubToBytes, rootPubKey)
import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import Data.String
import Data.Text (Text)
import Data.Text.Encoding
import SolidVM.Model.Storable hiding (size)
import Text.RawString.QQ

-- | Inserts a Certificate Registry contract into the genesis block with the BlockApps root cert as owner
-- | Accepts a list of X509 certificates, if there are any that need to be initialized at init besides root
insertCertRegistryContract :: [X509Certificate] -> GenesisInfo -> GenesisInfo
insertCertRegistryContract certs gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ registryAcct : rootAcct : certAccts,
      genesisInfoCodeInfo = initialCode ++ [CodeInfo certificateRegistryContract (Just "CertificateRegistry")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    encodedRegistry = encodeUtf8 certificateRegistryContract

    rootAddress' = fromPublicKey rootPubKey
    rootAddress = BAccount (NamedAccount rootAddress' UnspecifiedChain)
    rootSub = fromJust $ getCertSubject rootCert

    certSub' crt =
      case getCertSubject crt of
        Just s -> s
        Nothing -> error "Certificate requires a subject"
    maybeCertField = fromMaybe ""
    certUserAddress = fromPublicKey . subPub . certSub'
    rootAcct =
      SolidVMContractWithStorage
        0x1337
        1337
        (SolidVMCode "Certificate" (KECCAK256.hash encodedRegistry))
        [ (".owner", BAccount (NamedAccount ((fromJust . stringAddress) "509") UnspecifiedChain)),
          (".userAddress", BAccount (NamedAccount (fromPublicKey . subPub $ rootSub) UnspecifiedChain)),
          (".commonName", fromString $ subCommonName rootSub),
          (".country", fromString $ fromJust $ subCountry rootSub),
          (".organization", fromString $ subOrg rootSub),
          (".group", fromString $ fromJust $ subUnit rootSub),
          (".organizationalUnit", fromString $ fromJust $ subUnit rootSub),
          (".publicKey", BString . pubToBytes . subPub $ rootSub),
          (".certificateString", BString $ certToBytes rootCert),
          (".isValid", BBool True),
          (".parent", BAccount (NamedAccount (Address 0x0) UnspecifiedChain))
        ]

    -- Reversing the cert user address to create a placeholder Certificate contract address
    reverseAddr = Address . bytesToWord160 . reverse . word160ToBytes . unAddress . certUserAddress
    addrToCertIdx ad = BAccount (NamedAccount (fromJust . stringAddress $ ad) UnspecifiedChain)
    registryAcct =
      SolidVMContractWithStorage
        0x509
        509
        (SolidVMCode "CertificateRegistry" (KECCAK256.hash encodedRegistry))
        $ [ (".owner", rootAddress),
            (BC.pack $ ".addressToCertMap<a:" ++ show rootAddress' ++ ">", addrToCertIdx "1337")
          ]
          ++ map (\c -> (BC.pack $ ".addressToCertMap<a:" ++ show (certUserAddress c) ++ ">", addrToCertIdx . show . reverseAddr $ c)) certs

    certAccts =
      map
        ( \cert -> do
            let certSub = certSub' cert
            SolidVMContractWithStorage
              (reverseAddr cert)
              0
              (SolidVMCode "Certificate" (KECCAK256.hash encodedRegistry))
              [ (".owner", BAccount (NamedAccount ((fromJust . stringAddress) "509") UnspecifiedChain)),
                (".userAddress", BAccount (NamedAccount (fromPublicKey . subPub $ certSub) UnspecifiedChain)),
                (".commonName", fromString $ subCommonName certSub),
                (".country", fromString $ maybeCertField $ subCountry certSub),
                (".organization", fromString $ subOrg certSub),
                (".group", fromString $ maybeCertField $ subUnit certSub),
                (".organizationalUnit", fromString $ maybeCertField $ subUnit certSub),
                (".publicKey", BString . pubToBytes . subPub $ certSub),
                (".certificateString", BString $ certToBytes cert),
                (".isValid", BBool True),
                (".parent", BAccount (NamedAccount (fromMaybe (Address 0x0) $ getParentUserAddress cert) UnspecifiedChain))
              ]
        )
        certs

certificateRegistryContract :: Text
certificateRegistryContract =
  [r|
contract record Certificate {
    address owner;  // The CertificateRegistry Contract

    address public userAddress;
    address public parent;
    address[] public record children;


    // Store all the fields of a certificate in a Cirrus record
    string public commonName;
    string public country;
    string public organization;
    string public group;
    string public organizationalUnit;
    string public publicKey;
    string public certificateString;
    bool public isValid;

    constructor(string _certificateString) {
        owner = msg.sender;

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

contract record CertificateRegistry {
    // The registry maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    mapping(address => address) public record addressToCertMap;
    address public owner;

    event CertificateRegistered(string certificate);
    event CertificateRevoked(address userAddress);

    function registerCertificate(string newCertificateString) returns (int) {
        mapping(string => string) parsedCert = parseCert(newCertificateString);
        address parentUserAddress = address(parsedCert["parent"]);
        Certificate parentContract = Certificate(addressToCertMap[account(parentUserAddress)]);

        if (address(parentContract) != address(0) && parentContract.isValid() && verifyCertSignedBy(newCertificateString, parentContract.publicKey())) {
            // Create the new Certificate record
            Certificate c = new Certificate(newCertificateString);

            if (parentUserAddress != address(0x0)){
                parentContract.addChild(c.userAddress());
            }

            addressToCertMap[c.userAddress()] = address(c);
            emit CertificateRegistered(newCertificateString);
            return 200; // 200 = HTTP Status OK
        }
        return 400;
    }

    function getUserCert(address _address) returns (Certificate) {
        return Certificate(addressToCertMap[account(_address)]);
    }

    function getCertByAddress(address _address) returns (Certificate) {
        return Certificate(getCertByAccount(account(_address)));
    }

    function getCertByAccount(address _account) returns (Certificate) {
        return Certificate(addressToCertMap[account(_account)]);
    }

    function revokeCert(address userAddress){
        Certificate myCert = Certificate(addressToCertMap[account(userAddress)]);
        require(isChild(tx.certificate, myCert.userAddress()), "You don't have permission to revoke!");

        int childrenLength = myCert.revoke();
        for (int i = 0; i < childrenLength; i += 1) {
            revokeCert(myCert.getChild(i));
        }

        emit CertificateRevoked(userAddress);
    }

    function isChild(string pCert, address certUserAddress) returns (bool) {
        Certificate myCert = Certificate(addressToCertMap[account(certUserAddress)]);
        address parentUserAddress = myCert.parent();
        if(myCert.parent() != address(0x0) && pCert ==  Certificate(addressToCertMap[account(parentUserAddress)]).certificateString()){
            return true;
        }

        if(myCert.parent() != address(0x0)){
            return isChild(pCert, parentUserAddress);
        }

        return false;
    }
}|]
