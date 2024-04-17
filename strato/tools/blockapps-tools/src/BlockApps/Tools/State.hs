{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.State (doit) where

import BlockApps.Tools.Util
import Blockchain.Data.AddressStateDB
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader (runReaderT)
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import Data.Default
import qualified Data.NibbleString as N
import qualified Database.LevelDB as DB
import qualified Text.Colors as CL
import Text.Format

nibbleStringToByteString :: N.NibbleString -> B.ByteString
nibbleStringToByteString (N.EvenNibbleString x) = x
nibbleStringToByteString _ = error "nibbleStringToByteString called for Odd length nibblestring"

showVals :: DB.DB -> MP.StateRoot -> ResourceT IO ()
showVals sdb sr = do
  db <- DB.open "/tmp/.ethereumH/hash" def
  kvs <- runReaderT (MP.unsafeGetKeyVals sr "") sdb
  liftIO $ putStrLn $ "Number of items: " ++ show (length kvs) ++ "\n------------------------"
  forM_ kvs $ \(key, val) -> do
    unhashed <- DB.get db def $ nibbleStringToByteString key
    let keyShowVal =
          case unhashed of
            Nothing -> error "missing value in unhash table"
            Just x -> CL.yellow $ format x
    liftIO $
      putStrLn $
        keyShowVal
          ++ ":"
          ++ tab ("\n" ++ format (rlpDecode $ rlpDeserialize $ rlpDecode val :: AddressState))
          ++ "\n----------------------------"

doit :: MP.StateRoot -> IO ()
doit sr = DB.runResourceT $ do
  sdb <-
    DB.open
      "/tmp/.ethereumH/state"
      DB.defaultOptions {DB.cacheSize = 1024}

  showVals sdb sr