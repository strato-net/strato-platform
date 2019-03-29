{-# OPTIONS -fno-warn-deprecations #-}

module LevelDBTools (
  LevelKV(..),
  formatLevelKV,
  outputToLDB
  ) where

import Control.Monad.Trans.Resource
import Data.ByteString.Char8 (ByteString)
import Data.Conduit
import qualified Database.LevelDB as LDB

import Text.Format

data LevelKV = LevelKV ByteString ByteString deriving Show

formatLevelKV :: LevelKV -> String
formatLevelKV (LevelKV k v) = format k ++ " " ++ format v

outputToLDB :: Sink LevelKV (ResourceT IO) ()
outputToLDB = do
  ldb <- LDB.open "abcd2" LDB.defaultOptions{LDB.createIfMissing=True}
  outputKVs ldb
  return ()

  where
    outputKVs :: LDB.DB -> Sink LevelKV (ResourceT IO) ()
    outputKVs ldb = do
      value <- await
      case value of
        Just (LevelKV k v) -> do
--          liftIO $ putStrLn $ show k ++ " " ++ show v
          LDB.put ldb LDB.defaultWriteOptions k v
          outputKVs ldb
        Nothing -> return ()

