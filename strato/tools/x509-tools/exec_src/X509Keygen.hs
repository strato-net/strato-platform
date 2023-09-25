{-# LANGUAGE OverloadedStrings #-}

import BlockApps.X509
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy as BL
import Data.Coerce

data KeyData = KeyData
  { kdPrivateKey :: PrivateKey,
    kdPublicKey :: PublicKey,
    kdAddress :: Address
  }
  deriving (Show)

instance ToJSON KeyData where
  toJSON (KeyData priv pub addr) =
    object
      [ "privateKey" .= priv,
        "publicKey" .= pub,
        "address" .= addr
      ]

main :: IO ()
main = do
  priv <- newPrivateKey
  let keyData =
        KeyData
          { kdPrivateKey = priv,
            kdPublicKey = derivePublicKey priv,
            kdAddress = fromPrivateKey priv
          }

  let keyDataBS = encode keyData
      privBS = privToBytes $ coerce priv
  putStrLn "writing keydata to keydata.json"
  putStrLn "writing encoded private key to priv.pem"
  putStrLn $ C8.unpack $ BL.toStrict keyDataBS

  BL.writeFile "keydata.json" keyDataBS
  B.writeFile "priv.pem" privBS
