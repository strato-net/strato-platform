{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
module Blockchain.SolidVM.CodeCollectionDB
  ( compileSource
  , codeCollectionFromSource
  , codeCollectionFromHash
  ) where

import           Control.Exception
import           Control.Monad.IO.Class
import qualified Data.Aeson                           as Aeson
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL
import           Data.Foldable                        (foldrM)
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           Data.Source
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (decodeUtf8, encodeUtf8)
import           System.IO.Unsafe
import           Text.Parsec                          (runParser)
import           Text.Parsec.Error

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

compileSource :: Map T.Text T.Text -> Either ParseError CodeCollection
compileSource initCodeMap = do
  let getNamedContracts fileName src = do
        file <- runParser solidityFile "" (T.unpack fileName) $ T.unpack src
        let pragmas = \case
              Pragma _ n v -> Just (n, v)
              _ -> Nothing
            vmVersion' = if Just ("solidvm", "3.0") `elem` (pragmas <$> unsourceUnits file) then "svm3.0" else ""
        pure [(T.unpack name, xabiToContract (T.unpack name) (map T.unpack parents') vmVersion' xabi)
             | NamedXabi name (xabi, parents') <- unsourceUnits file]
      throwDuplicate (cName, contract) m = case M.lookup cName m of
        Nothing -> pure $ M.insert cName contract m
        Just _ ->  Left $ newErrorMessage (Message $ "Duplicate contract found: " ++ cName)
                                          (fromSourcePosition $ _sourceAnnotationStart $ _contractContext contract)
  allContracts <- fmap concat . traverse (uncurry getNamedContracts) $ M.toList initCodeMap
  deduplicatedContracts <- foldrM throwDuplicate M.empty allContracts
  pure . applyInheritance
        $ CodeCollection {
            _contracts = deduplicatedContracts
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
      let ecc = compileSource initMap
          cc = either (parseError "codeCollectionFromSource") id ecc
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
          let initMap = case Aeson.decode $ BL.fromStrict initCode of
                  Just l -> M.fromList l
                  Nothing -> M.singleton T.empty (decodeUtf8 initCode)
          let ecc = compileSource initMap
              cc = either (parseError "codeCollectionFromHash") id ecc
              codeMap' = M.insert hsh cc codeMap
          recordCacheSize $ M.size codeMap'
          liftIO $ writeIORef unsafeCodeMapIORef codeMap'
          return cc
        Nothing -> internalError "unknown code hash" hsh
