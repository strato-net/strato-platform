module Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromSource, codeCollectionFromHash) where

import           Control.Exception
import           Control.Monad.IO.Class
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Char8                as BC
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import qualified Data.Text                            as T
import           System.IO.Unsafe
import           Text.Parsec                          (runParser)

import           Blockchain.DB.CodeDB
import           Blockchain.SHA
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.Metrics

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File

import           CodeCollection

{-# NOINLINE unsafeCodeMapIORef #-}
unsafeCodeMapIORef :: IORef (Map SHA CodeCollection)
unsafeCodeMapIORef = unsafePerformIO $ newIORef M.empty

compileSource :: B.ByteString -> CodeCollection
compileSource initCode =
  let maybeFile = runParser solidityFile "" "" $ BC.unpack initCode
      file = either (error . show) id maybeFile

      namedContracts = [(T.unpack name, xabiToContract (T.unpack name) (map T.unpack parents') xabi)
                       | NamedXabi name (xabi, parents') <- unsourceUnits file]
  in applyInheritance
        $ CodeCollection {
            _contracts=M.fromList namedContracts
          }

codeCollectionFromSource :: (HasCodeDB m) => B.ByteString -> m (SHA, CodeCollection)
codeCollectionFromSource initCode = do
  let hsh = hash initCode
  codeMap <- liftIO $ readIORef unsafeCodeMapIORef
  case M.lookup hsh codeMap of
    Just cc -> do
      recordCacheEvent CacheHit
      return (hsh, cc)
    Nothing -> do
      recordCacheEvent StorageWrite
      hsh' <- addCode SolidVM initCode
      let cc = compileSource initCode
      let codeMap' = M.insert hsh cc codeMap
      recordCacheSize $ M.size codeMap'
      liftIO $ writeIORef unsafeCodeMapIORef codeMap'
      return $ assert (hsh == hsh') (hsh, cc)

codeCollectionFromHash :: HasCodeDB m => SHA -> m CodeCollection
codeCollectionFromHash hsh = do
  codeMap <- liftIO $ readIORef unsafeCodeMapIORef
  case M.lookup hsh codeMap of
    Just cc -> do
      recordCacheEvent CacheHit
      return cc
    Nothing -> do
      recordCacheEvent CacheMiss
      mCode <- getCode hsh
      case mCode of
        Just (_, initCode) -> do
          let cc = compileSource initCode
              codeMap' = M.insert hsh cc codeMap
          recordCacheSize $ M.size codeMap'
          liftIO $ writeIORef unsafeCodeMapIORef codeMap'
          return cc
        Nothing -> internalError "unknown code hash" hsh
