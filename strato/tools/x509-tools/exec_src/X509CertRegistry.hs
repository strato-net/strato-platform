{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}

import           Data.Proxy
import           Text.Read
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL
import qualified Data.Map.Strict                      as M
import           Data.Maybe
import qualified Data.Text                            as T
import qualified Data.Text.Encoding                   as T

import           Data.Source.Map
import           Network.HTTP.Client                  (newManager, defaultManagerSettings)
import           Options.Applicative                  hiding (Success)
import           Options.Applicative                  as Opt (value)
import           Servant.Client
import           Text.RawString.QQ
import qualified Data.Aeson                           as Ae

import           BlockApps.Bloc22.API
import           BlockApps.X509
import           Blockchain.Data.AlternateTransaction
import qualified Blockchain.Data.DataDefs             as DD
import           Blockchain.Data.Transaction
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.Wei

-- | The command line options
data Options
    = Options
        FilePath            -- ^ The private key of the node
        [FilePath]          -- ^ The root X509 ceritificates
        Nonce               -- ^ The transaction's nonce

main :: IO ()
main = execParser opts >>= entryPoint
    where opts = info (helper <*> parseOptions)
                    ( fullDesc
                        <> header "Post the CertificateRegistry contract"
                        <> progDesc "The CertificateRegistry contract is used to register X509 certificates to the network" )


parseNonce :: ReadM Nonce
parseNonce = maybeReader (\s -> Nonce <$> (readMaybe s :: Maybe Word256))

parseOptions :: Parser Options
parseOptions = Options
    <$> strOption
          ( long "priv"
         <> metavar "FILE"
         <> help "The PEM encoded root private key." )
    <*> some (strOption
          ( long "cert"
         <> metavar "FILE"
         <> help "The PEM encoded root X509 certificate for the network. By default this will be the BlockApps root certificate." ))
    <*> option parseNonce
          ( long "nonce"
         <> metavar "NONCE"
         <> Opt.value (Nonce 0)
         <> showDefaultWith (const "0")
         <> help "The nonce of this transaction." )


entryPoint :: Options -> IO ()
entryPoint (Options privPath certPaths nonce) = do
    eitherPriv <- bsToPriv <$> B.readFile privPath
    eitherCerts <- case certPaths of
        [] -> return $ Left "Oh no! You didn't give me a cert!"
        a -> do x509s <- traverse B.readFile a
                let eitherListCerts = fmap bsToCert x509s
                return $ sequenceA eitherListCerts

    case (eitherPriv, eitherCerts) of
        (Left s,  Left s') -> putStrLn $ "Oh no! The private key and certificate couldn't be parsed! " <> s <> "; " <> s'
        (Left s,  Right _) -> putStrLn $ "Oh no! The private key couldn't be parsed! " <> s
        (Right _, Left s') -> putStrLn $ "Oh no! The certificate couldn't be parsed! " <> s'
        (Right priv, Right certs) -> do
            let request = optionsToTX priv nonce
            putStrLn "We will make the following request to CertificateRegistry:\n"
            BL.putStr $ Ae.encode request

            -- setup servant client
            mgr <- newManager defaultManagerSettings
            stratoURL <- parseBaseUrl "http://localhost:3000/bloc/v2.2"
            let clientEnv = mkClientEnv mgr stratoURL

            -- post it
            result <- runClientM (postRawTransaction Nothing Nothing True request) clientEnv
            putStrLn $ "\n\nTransaction result: " <> show result

            let oops = error "We did not successfully post the CertificateRegistry!"
                strToAddr x = fromMaybe oops . stringAddress . T.unpack . head . T.splitOn "," $ T.pack x
                addr = case result of
                    (Right (BlocTxResult BlocTransactionResult {blocTransactionStatus=Success,
                        blocTransactionTxResult=Just DD.TransactionResult{..}})) -> strToAddr transactionResultContractsCreated
                    _ -> oops
            let request' = initializeCertificateRegistryTX priv addr certs $ succ nonce
            putStrLn "\n\nWe will make the following request to initializeCertificateRegistry of CertificateRegistry:\n"
            BL.putStr $ Ae.encode request'

            -- post initializeCertificateRegistry
            result' <- runClientM (postRawTransaction Nothing Nothing True request') clientEnv
            putStrLn $ "\n\nTransaction result: " <> show result'

-- servant client for the endpoint
postRawTransaction :: Maybe T.Text -> Maybe ChainId -> Bool -> PostBlocTransactionRawRequest
                   -> ClientM BlocChainOrTransactionResult
postRawTransaction = client (Proxy @ PostBlocTransactionRaw)


-- Convert the parsed and retrieved options into a raw transaction request
optionsToTX :: PrivateKey -> Nonce -> PostBlocTransactionRawRequest
optionsToTX priv nonce =
    let unsignedTx = UnsignedTransaction
            { unsignedTransactionNonce      = nonce
            , unsignedTransactionGasPrice   = Wei 10000        -- default val
            , unsignedTransactionGasLimit   = Gas 29000000000  -- default val
            , unsignedTransactionTo         = Nothing
            , unsignedTransactionValue      = Wei 0
            , unsignedTransactionInitOrData = Code $ T.encodeUtf8 $ serializeSourceMap $ namedSource "" certificateRegistryContract
            , unsignedTransactionChainId    = Nothing
            }
        txHash = rlpHash unsignedTx
        sig = signMsg priv txHash
        (rr,s,v) = getSigVals sig
    in PostBlocTransactionRawRequest
        (fromPrivateKey priv)
        (unsignedTransactionNonce unsignedTx)
        (unsignedTransactionGasPrice unsignedTx)
        (unsignedTransactionGasLimit unsignedTx)
        (unsignedTransactionTo unsignedTx)
        (unsignedTransactionValue unsignedTx)
        (unsignedTransactionInitOrData unsignedTx)
        (unsignedTransactionChainId unsignedTx)
        rr
        s
        (Just v)
        (Just $ M.fromList $ [("VM", "SolidVM"), ("name", "CertificateRegistry"),
            ("history", "Certificate"), ("args", "()") ])


initializeCertificateRegistryTX :: PrivateKey -> Address -> [X509Certificate] ->Nonce -> PostBlocTransactionRawRequest
initializeCertificateRegistryTX priv addr certs nonce =
    let unsignedTx = UnsignedTransaction
            { unsignedTransactionNonce      = nonce
            , unsignedTransactionGasPrice   = Wei 10000        -- default val
            , unsignedTransactionGasLimit   = Gas 29000000000  -- default val
            , unsignedTransactionTo         = Just addr
            , unsignedTransactionValue      = Wei 0
            , unsignedTransactionInitOrData = Code $ B.empty
            , unsignedTransactionChainId    = Nothing
            }
        txHash = rlpHash unsignedTx
        sig = signMsg priv txHash
        (rr,s,v) = getSigVals sig
    in PostBlocTransactionRawRequest
        (fromPrivateKey priv)
        (unsignedTransactionNonce unsignedTx)
        (unsignedTransactionGasPrice unsignedTx)
        (unsignedTransactionGasLimit unsignedTx)
        (unsignedTransactionTo unsignedTx)
        (unsignedTransactionValue unsignedTx)
        (unsignedTransactionInitOrData unsignedTx)
        (unsignedTransactionChainId unsignedTx)
        rr
        s
        (Just v)
        (Just $ M.fromList [("VM", "SolidVM"), ("funcName", "initializeCertificateRegistry"), ("args", T.pack $ "(" <> show (fmap certToBytes certs) <> ")")])

certificateRegistryContract :: T.Text
certificateRegistryContract = [r|
contract Certificate {
    address owner;  // The CertificateRegistery Contract

    address public userAddress;
    address public parent;
    address[] public children;

    
    // Store all the fields of a certificate in a Cirrus record
    string commonName;
    string country;
    string organization;
    string group;
    string organizationalUnit;
    string public publicKey;
    string public certificateString;
    bool public isValid;
    uint expirationDate;

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
        expirationDate = uint(parsedCert["expirationDate"],10);
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

contract CertificateRegistry {
    // The registry maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    mapping(address => Certificate) addressToCertMap;
    address public owner;

    bool initialized;

    event CertificateRegistered(string certificate);
    event CertificateRevoked(address userAddress);
    event CertificateRegistryInitialized();

    constructor() {
        require(account(this, "self").chainId == 0, "You must post this contract on the main chain!");
        owner = msg.sender;

        initialized = false;
    }

    function initializeCertificateRegistry(string[] _rootCerts) returns (int) {
        require(!initialized, "The CertificateRegistry has already been initialized!");        
        
        for (uint i=0; i < _rootCerts.length; i += 1) {
            // Create the Certificate record
            Certificate c = new Certificate(_rootCerts[i]);
            // Register the root certificates and emit event
            addressToCertMap[c.userAddress()] = c;
            
            emit CertificateRegistered(_rootCerts[i]);
        }
        
        initialized = true;
        emit CertificateRegistryInitialized();
        
        return 200;
    }
    
    function registerCertificate(string newCertificateString) returns (int) {
        require(initialized, "You must first initialize with initializeCertificateRegistry!");
        
        mapping(string => string) parsedCert = parseCert(newCertificateString);
        address parentUserAddress = address(parsedCert["parent"]);
        Certificate parentContract = addressToCertMap[account(parentUserAddress)];
        
        if (parentContract.isValid() && verifyCertSignedBy(newCertificateString, parentContract.publicKey())){
            // Create the new Certificate record
            Certificate c = new Certificate(newCertificateString);

            if (parentUserAddress != address(0x0)){
                parentContract.addChild(c.userAddress());    
            }

            addressToCertMap[c.userAddress()] = c;
            
            
            emit CertificateRegistered(newCertificateString);
    
            return 200; // 200 = HTTP Status OK
        }
        return 400;
    }

    function getUserCert(address _address) returns (Certificate) {
        return addressToCertMap[account(_address)];
    }
    
    function getCertByAddress(address _address) returns (Certificate) {
        return getCertByAccount(account(_address));
    }
    
    function getCertByAccount(address _account) returns (Certificate) {
        return addressToCertMap[account(_account)];
    }
    
    function revokeCert(address userAddress){
        Certificate myCert = addressToCertMap[account(userAddress)];
        require(isChild(tx.certificate, myCert.userAddress()), "You don't have permission to revoke!");

        int childrenLength = myCert.revoke();
        for (int i = 0; i < childrenLength; i += 1) {
            revokeCert(myCert.getChild(i));
        }
        
        emit CertificateRevoked(userAddress);
    }
    
    function isChild(string pCert, address certUserAddress) returns (bool) {
        Certificate myCert = addressToCertMap[account(certUserAddress)];
        address parentUserAddress = myCert.parent();
        if(myCert.parent() != address(0x0) && pCert ==  addressToCertMap[account(parentUserAddress)].certificateString()){
            return true;
        }
        
        if(myCert.parent() != address(0x0)){
            return isChild(pCert, parentUserAddress);
        }
        
        return false;
    }
}|]
