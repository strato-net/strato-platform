module BlockApps.Tools.ChainHash where

import Blockchain.Data.ChainInfo
import Blockchain.Strato.Model.Keccak256
import Data.Aeson
import qualified Data.ByteString as B
import System.Exit
import Text.Format
import Text.Printf

chainHash :: IO ()
chainHash = do
  input <- B.getContents
  let eInfo = eitherDecodeStrict' input
  case eInfo of
    Left err -> die $ show err
    Right info -> do
      printf "Parsed ChainInfo: %s\n" (format info)
      let hsh = rlpHash (info :: ChainInfo)
      printf "Hash: %s\n" (format hsh)
