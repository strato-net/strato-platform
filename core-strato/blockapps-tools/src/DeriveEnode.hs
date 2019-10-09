module DeriveEnode where

import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Base64 as B64
import qualified Data.ByteString.Char8 as C8
import Data.Maybe
import System.Exit
import Text.Printf

import qualified Network.Haskoin.Crypto     as HK
import Blockchain.Data.PubKey (pointToBytes)
import Blockchain.Strato.Discovery.P2PUtil (hPubKeyToPubKey)
import Blockchain.Strato.Model.Address
import Text.Format

deriveEnode :: String -> String -> IO ()
deriveEnode iPrvKey ip = do
  let !bytes = either (error . ("Invalid Base64 private key: " ++). show) id . B64.decode . C8.pack $ iPrvKey
      !hPrvKey = fromMaybe (error "Invalid private key") . HK.decodePrvKey HK.makePrvKey $ bytes
      !hPubKey = HK.derivePubKey hPrvKey
      !address = prvKey2Address hPrvKey
      !ePoint = hPubKeyToPubKey hPubKey
  case ePoint of
    Left err -> die $ show err
    Right point -> do
      printf "address: %s\n" (format address)
      printf "point: %s\n" (show point)
      let nodeid = C8.unpack $ B16.encode $ pointToBytes point
      printf "nodeid: %s\n" nodeid
      printf "enode://%s:%s:30303\n" nodeid ip
