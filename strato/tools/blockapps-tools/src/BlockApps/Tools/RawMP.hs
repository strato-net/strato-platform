{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.RawMP (doit) where

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import qualified Data.NibbleString as N
import qualified Database.LevelDB as DB
import Text.Format

formatKV :: (N.NibbleString, RLPObject) -> String
formatKV (key, val) =
  format key ++ ":\n  " ++ format (rlpDeserialize $ rlpDecode val)

showVals :: MonadIO m => DB.DB -> MP.StateRoot -> m ()
showVals sdb sr = do
  kvs <- runReaderT (MP.unsafeGetKeyVals sr "") sdb
  liftIO . putStrLn $ unlines $ formatKV <$> kvs


doit :: String -> MP.StateRoot -> IO ()
doit filename sr = DB.runResourceT $ do
  sdb <-
    DB.open
      ("/tmp/.ethereumH/" ++ filename) 
      DB.defaultOptions {DB.cacheSize = 1024}
  showVals sdb sr
