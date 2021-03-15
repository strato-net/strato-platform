{-# LANGUAGE OverloadedStrings #-}

import           BlockApps.X509
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1

import           Data.Aeson
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Lazy                    as BL
import           Data.Coerce


data KeyData = KeyData
  { kdPrivateKey :: PrivateKey
  , kdPublicKey  :: PublicKey
  , kdAddress    :: Address
  } deriving Show


instance ToJSON KeyData where
  toJSON (KeyData priv pub addr) = 
      object [ "privateKey" .= priv
             , "publicKey"  .= pub
             , "address"    .= addr
             ]

main :: IO ()
main = do

  priv <- newPrivateKey
  let keyData = KeyData 
        { kdPrivateKey = priv
        , kdPublicKey  = derivePublicKey priv
        , kdAddress    = fromPrivateKey priv
        }

  let keyDataBS = encode keyData
  putStrLn "writing keydata to keydata.json"
  putStrLn $ show keyDataBS
  BL.writeFile "keydata.json" keyDataBS
  
  let privBS = privToBytes $ coerce priv
  B.writeFile "priv.pem" privBS

  
