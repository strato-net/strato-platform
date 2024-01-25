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
  format key ++ ": " ++ format (rlpDeserialize $ rlpDecode val)

showVals :: MonadIO m => DB.DB -> MP.StateRoot -> m ()
showVals sdb sr = do
  kvs <- runReaderT (MP.unsafeGetKeyVals sr "") sdb
  liftIO . print $ length kvs
  --liftIO . putStrLn $ displayS (renderPretty 1.0 200 $ vsep $ formatKV <$> kvs) ""
  liftIO . putStrLn $ unlines $ formatKV <$> kvs


doit :: String -> MP.StateRoot -> IO ()
doit filename sr = DB.runResourceT $ do
  --    dbs <- openDBs theType
  --    homeDir <- liftIO getHomeDirectory
  sdb <-
    DB.open
      filename
      DB.defaultOptions {DB.cacheSize = 1024}
  showVals sdb sr
