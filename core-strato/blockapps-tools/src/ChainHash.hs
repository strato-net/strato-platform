module ChainHash where

import qualified Data.ByteString as B
import Data.Aeson
import System.Exit
import Text.Printf

import Blockchain.Data.ChainInfo
import Blockchain.Strato.Model.SHA
import Text.Format

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
