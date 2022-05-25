{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TypeApplications #-}

import           Data.Proxy
import           Text.Read
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL
import qualified Data.Map.Strict                      as M
import qualified Data.Text                            as T
import qualified Data.Text.Encoding                   as T

import           Data.Source.Map
import           Network.HTTP.Client                  (newManager, defaultManagerSettings)
import           Options.Applicative
import           Options.Applicative                  as Opt (value)
import           Servant.Client
import           Text.RawString.QQ
import qualified Data.Aeson                           as Ae

import           BlockApps.Bloc22.API
import           BlockApps.Ethereum
import           BlockApps.X509 
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
        (Maybe FilePath)    -- ^ The root X509 ceritificate
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
    <*> optional (strOption
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
entryPoint (Options privPath certPath nonce) = do
    eitherPriv <- bsToPriv <$> B.readFile privPath
    eitherCert <- case certPath of
        Nothing -> return $ Right rootCert
        Just path -> bsToCert <$> B.readFile path

    case (eitherPriv, eitherCert) of 
        (Left s,  Left s') -> putStrLn $ "Oh no! The private key and certificate couldn't be parsed! " <> s <> "; " <> s'
        (Left s,  Right _) -> putStrLn $ "Oh no! The private key couldn't be parsed! " <> s
        (Right _, Left s') -> putStrLn $ "Oh no! The certificate couldn't be parsed! " <> s'
        (Right priv, Right cert) -> do
            let request = optionsToTX priv cert nonce
            putStrLn "We will make the following request:\n"
            BL.putStr $ Ae.encode request

            -- setup servant client
            mgr <- newManager defaultManagerSettings
            stratoURL <- parseBaseUrl "http://strato:3000/bloc/v2.2"
            let clientEnv = ClientEnv mgr stratoURL Nothing

            -- post it
            result <- runClientM (postRawTransaction Nothing Nothing True request) clientEnv
            putStrLn $ "\n\nTransaction result: " <> show result


-- servant client for the endpoint
postRawTransaction :: Maybe T.Text -> Maybe ChainId -> Bool -> PostBlocTransactionRawRequest
                   -> ClientM BlocChainOrTransactionResult
postRawTransaction = client (Proxy @ PostBlocTransactionRaw)


-- Convert the parsed and retrieved options into a raw transaction request
optionsToTX :: PrivateKey -> X509Certificate -> Nonce -> PostBlocTransactionRawRequest
optionsToTX priv cert nonce = 
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
        (Just $ M.fromList $ [("VM", "SolidVM"), ("name", "CertificateRegistry"), ("args", T.pack $ "(" <> show (certToBytes cert) <> ")")])


certificateRegistryContract :: T.Text
certificateRegistryContract = [r|
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
contract CertificateRegistry {
    // The registry maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    Certificate[] certificates;
    mapping(account => uint) certificatesMap;
    
    constructor(string rootCert) {
        // Register the root certificate
        account newAccount = registerCert(rootCert);
        
        // Create the Certificate record
        Certificate c = new Certificate(newAccount, rootCert);
        certificates.push(c);
        certificatesMap[newAccount] = certificates.length;
    }
    
    function registerCertificate(string newCertificateString) returns (int) {

        // Register the certificate into LevelDB
        account newAccount = registerCert(newCertificateString);
        
        // Create the new Certificate record
        Certificate c = new Certificate(newAccount, newCertificateString);
        certificates.push(c);
        certificatesMap[newAccount] = certificates.length;
        
        return 200; // 200 = HTTP Status OK
    }
}|]
