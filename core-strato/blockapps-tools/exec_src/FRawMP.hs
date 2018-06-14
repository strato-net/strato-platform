{-# LANGUAGE OverloadedStrings #-}
module FRawMP where

import           Control.Monad                          (void)
import           Control.Monad.IO.Class
import qualified Database.LevelDB                       as DB
import           Text.PrettyPrint.ANSI.Leijen           hiding ((<$>), (</>))

import           Blockchain.Data.RLP

import qualified Blockchain.Database.MerklePatricia     as MP
import qualified Blockchain.Database.MerklePatricia.Map as MP

doit :: String -> MP.StateRoot->IO()
doit filename sr = void . DB.runResourceT $ do
    sdb <- DB.open filename DB.defaultOptions{DB.cacheSize=1024}
    MP.map f $ MP.MPDB sdb sr
    where
        f k v = liftIO $ putStrLn $ displayS (renderPretty 1.0 200 $ formatKV k v) ""
        formatKV key val = pretty key <> text ": " <> pretty (rlpDeserialize $ rlpDecode val)
