{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Options ()
import Blockchain.VMOptions ()
import Data.Aeson
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Executable.EVMFlags ()
import HFlags
import Strato.Lite
import Strato.Lite.Options

main :: IO ()
main = do
  _ <- $initHFlags "Strato Lite"
  let nodesRes = eitherDecode . BL.fromStrict $ BC.pack flags_nodes
  either error runStratoLite nodesRes
