{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           HFlags
import           Strato.Lite
import           Strato.Lite.Options
import           Data.Aeson
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy  as BL


main :: IO ()
main = do
  _ <- $initHFlags "Strato Lite"
  let nodesRes = eitherDecode . BL.fromStrict $ BC.pack flags_nodes
      connectionsRes = eitherDecode . BL.fromStrict $ BC.pack flags_connections
  case (nodesRes, connectionsRes) of
    (Right n, Right c) -> runStratoLite n c
    (Left e, _) -> error e
    (_, Left e) -> error e