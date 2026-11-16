{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.RawMP (doit) where

import Blockchain.Data.RLP
import qualified Control.Monad.Composable.StateDB as MP
import Control.Monad.IO.Class
import qualified Data.NibbleString as N
import qualified Database.LevelDB as DB
import SolidVM.Model.Storable
import Text.Format

formatKV :: (N.NibbleString, RLPObject) -> String
formatKV (key, val) =
  format key ++ ":\n  " ++ decodeAndFormatVal
  where
    decodeAndFormatVal = case val of
      RLPArray _ -> format (rlpDecode val :: BasicValue)
      _ -> format (rlpDeserialize $ rlpDecode val)

showVals :: MonadIO m => DB.DB -> MP.StateRoot -> m ()
showVals sdb sr = do
  kvs <- MP.runStateDBOn sdb (MP.unsafeGetKeyVals sr "")
  liftIO . putStrLn $ unlines $ formatKV <$> kvs


doit :: String -> MP.StateRoot -> IO ()
doit filename sr = DB.runResourceT $ do
  sdb <-
    DB.open
      filename
      DB.defaultOptions {DB.cacheSize = 1024}
  showVals sdb sr
