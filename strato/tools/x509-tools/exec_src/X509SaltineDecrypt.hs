{-# LANGUAGE RecordWildCards #-}

import BlockApps.X509.Keys
import qualified Crypto.Saltine.Class as CS
import qualified Crypto.Saltine.Core.SecretBox as CS
import Data.ByteString (ByteString)
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.String
import Options.Applicative
import Strato.Strato23.Crypto
import Strato.Strato23.Server.Password

data Options = Options
  { salt :: ByteString,
    nonce :: CS.Nonce,
    password :: Password,
    ciphertext :: ByteString,
    privPem :: Bool
  }
  deriving (Show)

main :: IO ()
main = execParser opts >>= entryPoint
  where
    opts =
      info
        (helper <*> parseOptions)
        ( fullDesc
            <> header "Post the CertificateRegistry contract"
            <> progDesc "The CertificateRegistry contract is used to register X509 certificates to the network"
        )

parseHexBS :: ReadM ByteString
parseHexBS = eitherReader (\s -> B16.decode . fromString $ s)

parseNonce :: ReadM CS.Nonce
parseNonce = eitherReader (\s -> (maybeToEither "Invalid Nonce!" . CS.decode) =<< (B16.decode . fromString $ s))

parsePassword :: ReadM Password
parsePassword = textPassword <$> str

maybeToEither :: a -> Maybe b -> Either a b
maybeToEither _ (Just b) = Right b
maybeToEither a Nothing = Left a

parseOptions :: Parser Options
parseOptions =
  Options
    <$> option
      parseHexBS
      ( long "salt"
          <> metavar "HEX"
          <> help "The salt of the cypher text"
      )
    <*> option
      parseNonce
      ( long "nonce"
          <> metavar "HEX"
          <> help "The nonce of the cypher text"
      )
    <*> option
      parsePassword
      ( long "password"
          <> metavar "STRING"
          <> help "The password of the cypher text"
      )
    <*> option
      parseHexBS
      ( long "ciphertext"
          <> metavar "HEX"
          <> help "The cypher text"
      )
    <*> switch
      ( long "privPem"
          <> help "Is this pem format?"
      )

-- $ x509-saltine-decrypt
-- Decryptin failed!

entryPoint :: Options -> IO ()
entryPoint = putStrLn . maybe "Failed to decrypt the ciphertext!" C8.unpack . entryPointPure

entryPointPure :: Options -> Maybe ByteString
entryPointPure Options {..}
  | privPem = privToBytes <$> decryptSecKey (getKeyFromPasswordAndSalt password salt) nonce ciphertext
  | otherwise = B16.encode <$> decrypt (getKeyFromPasswordAndSalt password salt) nonce ciphertext
