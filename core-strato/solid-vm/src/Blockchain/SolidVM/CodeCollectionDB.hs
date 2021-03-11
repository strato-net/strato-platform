{-# LANGUAGE FlexibleContexts #-}
module Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromSource, codeCollectionFromHash) where

import           Control.Exception
import           Control.Monad.IO.Class
import qualified Data.ByteString                      as B
import qualified Data.ByteString.UTF8                 as UTF8
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import qualified Data.Text                            as T
import           System.IO.Unsafe
import           Text.Parsec                          (runParser)

import           Blockchain.Data.RLP                  (rlpDecode, rlpDeserializeMaybe)
import           Blockchain.DB.CodeDB
import           Blockchain.SolidVM.Exception         hiding (assert)
import           Blockchain.SolidVM.Metrics
import           Blockchain.Strato.Model.Keccak256

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File

import           CodeCollection

{-# NOINLINE unsafeCodeMapIORef #-}
unsafeCodeMapIORef :: IORef (Map Keccak256 CodeCollection)
unsafeCodeMapIORef = unsafePerformIO $ newIORef M.empty

compileSource :: Map String String -> CodeCollection
compileSource initCodeMap =
  let getNamedContracts fileName src =
        let maybeFile = runParser solidityFile "" fileName $ src
            file = either (parseError "compileSource") id maybeFile

         in [(T.unpack name, xabiToContract (T.unpack name) (map T.unpack parents') xabi)
            | NamedXabi name (xabi, parents') <- unsourceUnits file]
      allContracts = concat . map (uncurry getNamedContracts) $ M.toList initCodeMap
   in applyInheritance
        $ CodeCollection {
            _contracts=M.fromList allContracts
          }

codeCollectionFromSource :: (MonadIO m, HasCodeDB m) => B.ByteString -> m (Keccak256, CodeCollection)
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
      -- TODO: I think this should be in the code DB, but I'm leaving it here for now
      let initMap = case rlpDeserializeMaybe initCode of
            Just m -> rlpDecode m
            Nothing -> M.singleton "" (UTF8.toString initCode)
      let cc = compileSource initMap
      let codeMap' = M.insert hsh cc codeMap
      recordCacheSize $ M.size codeMap'
      liftIO $ writeIORef unsafeCodeMapIORef codeMap'
      return $ assert (hsh == hsh') (hsh, cc)

codeCollectionFromHash :: (MonadIO m, HasCodeDB m) => Keccak256 -> m CodeCollection
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
          let initMap = case rlpDeserializeMaybe initCode of
                Just m -> rlpDecode m
                Nothing -> M.singleton "" (UTF8.toString initCode)
          let cc = compileSource initMap
              codeMap' = M.insert hsh cc codeMap
          recordCacheSize $ M.size codeMap'
          liftIO $ writeIORef unsafeCodeMapIORef codeMap'
          return cc
        Nothing -> internalError "unknown code hash" hsh
