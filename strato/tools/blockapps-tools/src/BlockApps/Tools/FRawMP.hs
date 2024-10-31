{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Tools.FRawMP where

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Map as MP
import Control.Monad (void)
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import qualified Database.LevelDB as DB
import Text.Format

doit :: String -> MP.StateRoot -> IO ()
doit filename sr = void . DB.runResourceT $ do
  sdb <- DB.open ("/tmp/.ethereumH/" ++ filename) DB.defaultOptions {DB.cacheSize = 1024}
  runReaderT (MP.map f sr) sdb
  where
    --f k v = liftIO $ putStrLn $ displayS (renderPretty 1.0 200 $ formatKV k v) ""
    f k v = liftIO $ putStrLn $ formatKV k v
    formatKV key val = format key ++ ": " ++ format (rlpDeserialize $ rlpDecode val)
