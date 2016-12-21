{-# LANGUAGE OverloadedStrings #-}

module FRawMP
    (
     doit
    ) where

import Control.Monad.IO.Class
import qualified Database.LevelDB as DB
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))

import qualified Data.NibbleString as N
import Blockchain.Data.RLP

import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import qualified Blockchain.Database.MerklePatricia.Map as MP

formatKV::N.NibbleString->RLPObject->Doc
formatKV key val =
    pretty key <> text ": " <> pretty (rlpDeserialize $ rlpDecode val)

{-
showVals::DB.MonadResource m=>DB.DB->MP.StateRoot->m ()
showVals sdb sr = do
  kvs <- MP.unsafeGetKeyVals MP.MPDB{MP.ldb=sdb, MP.stateRoot=sr} ""
  liftIO $ putStrLn $ show $ length kvs
  --liftIO $ putStrLn $ displayS (renderPretty 1.0 200 $ vsep $ formatKV <$> kvs) ""
  liftIO $ putStrLn $ displayS (renderPretty 1.0 200 $ vsep $ formatKV <$> kvs) "" 
-}

f k v = do
  liftIO $ putStrLn $ displayS (renderPretty 1.0 200 $ formatKV k v) "" 

doit::String->MP.StateRoot->IO()
doit filename sr = do
  DB.runResourceT $ do
    sdb <- DB.open filename
           DB.defaultOptions{DB.cacheSize=1024}

    MP.map f $ MP.MPDB sdb sr
    return ()

