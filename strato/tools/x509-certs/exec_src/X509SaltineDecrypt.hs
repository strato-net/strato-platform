{-# LANGUAGE RecordWildCards       #-}

import           Data.String
import           Data.ByteString                    (ByteString)
import           Options.Applicative
import qualified Data.ByteString.Base16             as B16
import qualified Crypto.Saltine.Class               as CS             
import qualified Crypto.Saltine.Core.SecretBox      as CS

import           Strato.Strato23.Server.Password
import           Strato.Strato23.Crypto

data Options = Options {
    salt :: ByteString ,
    nonce :: CS.Nonce ,
    password :: Password,
    cypherText :: ByteString
} 

main :: IO ()
main = execParser opts >>= entryPoint
    where opts = info (helper <*> parseOptions)
                    ( fullDesc
                        <> header "Post the CertificateRegistry contract"
                        <> progDesc "The CertificateRegistry contract is used to register X509 certificates to the network" )

parseHexBS :: ReadM ByteString
parseHexBS = eitherReader (\s -> B16.decode . fromString $ s)

parseNonce :: ReadM CS.Nonce
parseNonce = eitherReader (\s -> (maybeToEither "Invalid Nonce!" . CS.decode) =<< (B16.decode . fromString $ s))

parsePassword :: ReadM Password
parsePassword = textPassword <$> str

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
           ( long "cypherText"
          <> metavar "HEX"
          <> help "The cypher text")
    



entryPoint :: Options -> IO ()
entryPoint o = print $ entryPointPure o 


entryPointPure :: Options -> Maybe ByteString
entryPointPure Options{..} = decrypt (getKeyFromPasswordAndSalt password salt) nonce cypherText 



