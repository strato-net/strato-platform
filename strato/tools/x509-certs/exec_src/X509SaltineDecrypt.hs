{-# LANGUAGE RecordWildCards       #-}

import           Data.String
import           Data.ByteString                    (ByteString)
import           Data.Text.Encoding
import           Data.Maybe
import           Control.Monad
import           Options.Applicative
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Char8              as C8
import qualified Crypto.KDF.Scrypt                 as Scrypt
import qualified Crypto.Saltine.Core.SecretBox     as SecretBox
import qualified Crypto.Saltine.Class              as Saltine
import qualified Crypto.Saltine.Internal.ByteSizes as Saltine
import           Blockchain.Strato.Model.Secp256k1

import           BlockApps.X509.Keys 


data Options = Options {
    salt :: ByteString ,
    nonce :: SecretBox.Nonce ,
    password :: ByteString,
    ciphertext :: ByteString,
    privPem :: Bool
}

main :: IO ()
main = execParser opts >>= entryPoint
    where opts = info (helper <*> parseOptions)
                    ( fullDesc
                        <> header "Post the CertificateRegistry contract"
                        <> progDesc "The CertificateRegistry contract is used to register X509 certificates to the network" )

parseHexBS :: ReadM ByteString
parseHexBS = eitherReader (\s -> B16.decode . fromString $ s)

parseNonce :: ReadM SecretBox.Nonce
parseNonce = eitherReader (\s -> (maybeToEither "Invalid Nonce!" . Saltine.decode) =<< (B16.decode . fromString $ s))

parsePassword :: ReadM ByteString
parsePassword = encodeUtf8 <$> str

maybeToEither :: a -> Maybe b -> Either a b
maybeToEither _ (Just b) = Right b
maybeToEither a Nothing  = Left a


parseOptions :: Parser Options
parseOptions = Options
    <$> option parseHexBS
          ( long "salt"
         <> metavar "HEX"
         <> help "The salt of the cypher text" )
    <*> option parseNonce
          ( long "nonce"
         <> metavar "HEX"
         <> help "The nonce of the cypher text" )
    <*> option parsePassword
          ( long "password"
         <> metavar "STRING"
         <> help "The password of the cypher text" )
    <*> option parseHexBS
           ( long "ciphertext"
          <> metavar "HEX"
          <> help "The cypher text")
    <*> switch
           ( long "privPem"
          <> help "Is this pem format?")


-- $ x509-saltine-decrypt
-- Decryptin failed!
entryPoint :: Options -> IO ()
entryPoint = putStrLn . maybe "Failed to decrypt the ciphertext!" C8.unpack . entryPointPure



entryPointPure :: Options -> Maybe ByteString
entryPointPure Options{..}
    | privPem = privToBytes <$> decryptSecKey (getKeyFromPasswordAndSalt password salt) nonce ciphertext 
    | otherwise = B16.encode <$> decrypt (getKeyFromPasswordAndSalt password salt) nonce ciphertext

-- Copied from Strato.Strato23.Crypto to avoid cyclical dependencies
decrypt
  :: SecretBox.Key
  -> SecretBox.Nonce
  -> ByteString -- encrypted secret key
  -> Maybe ByteString
decrypt = SecretBox.secretboxOpen

-- Copied from Strato.Strato23.Crypto to avoid cyclical dependencies
decryptSecKey
  :: SecretBox.Key
  -> SecretBox.Nonce
  -> ByteString -- encrypted secret key
  -> Maybe PrivateKey
decryptSecKey key nonce = importPrivateKey <=< decrypt key nonce

-- Copied from Strato.Strato23.Crypto to avoid cyclical dependencies
getKeyFromPasswordAndSalt :: ByteString -> ByteString -> SecretBox.Key
getKeyFromPasswordAndSalt pw salt = 
  let scryptParams = Scrypt.Parameters
        { Scrypt.n = 16384
        , Scrypt.r = 8
        , Scrypt.p = 1
        , Scrypt.outputLength = Saltine.secretBoxKey
        }
  in fromMaybe (error "could not decode encryption key") . Saltine.decode $
     Scrypt.generate scryptParams pw salt
