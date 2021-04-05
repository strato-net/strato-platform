{-# LANGUAGE FlexibleContexts #-}
module Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromSource, codeCollectionFromHash) where

import           Control.Exception
import           Control.Monad.IO.Class
import qualified Data.Aeson                           as Aeson
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           Data.Text                            (Text)
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (decodeUtf8, encodeUtf8)
import           System.IO.Unsafe
import           Text.Parsec                          (runParser)

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

compileSource :: Map T.Text T.Text -> CodeCollection
compileSource initCodeMap =
  let getNamedContracts fileName src =
        let maybeFile = runParser solidityFile "" (T.unpack fileName) $ T.unpack src
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
  let initList = case Aeson.decode $ BL.fromStrict initCode of
        Just l -> l
        Nothing -> case Aeson.decode $ BL.fromStrict initCode of
          Just m -> M.toList m
          Nothing -> [(T.empty, decodeUtf8 initCode)] -- for backwards compatibility
      initMap = M.fromList initList
      canonicalInitCode = case initList of
        [(t, src)] | T.null t -> encodeUtf8 src -- for backwards compatibility
        _ -> BL.toStrict $ Aeson.encode initList
      hsh = hash canonicalInitCode
  codeMap <- liftIO $ readIORef unsafeCodeMapIORef
  case M.lookup hsh codeMap of
    Just cc -> do
      recordCacheEvent CacheHit
      return (hsh, cc)
    Nothing -> do
      recordCacheEvent StorageWrite
      hsh' <- addCode SolidVM canonicalInitCode
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
          let initMap = case Aeson.decode $ BL.fromStrict initCode :: Maybe (Map Text Text) of
                Just m -> m
                Nothing -> case Aeson.decode $ BL.fromStrict initCode :: Maybe [(Text, Text)] of
                  Just l -> M.fromList l
                  Nothing -> M.singleton T.empty (decodeUtf8 initCode)
          let cc = compileSource initMap
              codeMap' = M.insert hsh cc codeMap
          recordCacheSize $ M.size codeMap'
          liftIO $ writeIORef unsafeCodeMapIORef codeMap'
          return cc
        Nothing -> internalError "unknown code hash" hsh
