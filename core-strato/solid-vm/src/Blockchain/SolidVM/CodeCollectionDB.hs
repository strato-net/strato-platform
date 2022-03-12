{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE RankNTypes #-}
module Blockchain.SolidVM.CodeCollectionDB
  ( ParseOrSolidVMError(..)
  , parseSource
  , parseSourceWithAnnotations
  , compileSourceNoInheritance
  , compileSource
  , compileSourceWithAnnotations
  , codeCollectionFromSource
  , codeCollectionFromHash
  ) where

import           Control.Exception
import           Control.Monad                        ((<=<))
import           Control.Monad.IO.Class
import qualified Data.Aeson                           as Aeson
import           Data.Bifunctor                       (bimap, first)
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL
import           Data.Foldable                        (foldrM)
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           Data.Maybe                           (catMaybes)
import           Data.Source
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (decodeUtf8, encodeUtf8)
import           Data.Traversable                     (for)
import           System.IO.Unsafe
import           Text.Parsec                          (runParser)
import           Text.Parsec.Error

import           Blockchain.DB.CodeDB
import           Blockchain.SolidVM.Exception         hiding (assert)
import           Blockchain.SolidVM.Metrics
import           Blockchain.Strato.Model.Keccak256

import           SolidVM.Model.CodeCollection
import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File

data ParseOrSolidVMError = PEx ParseError
                         | SVMEx (Positioned ((,) SolidException)) deriving (Show)

{-# NOINLINE unsafeCodeMapIORef #-}
unsafeCodeMapIORef :: IORef (Map Keccak256 CodeCollection)
unsafeCodeMapIORef = unsafePerformIO $ newIORef M.empty

withAnnotations :: (a -> Either ParseOrSolidVMError b) -> a -> Either [SourceAnnotation T.Text] b
withAnnotations f = first unwind . f
  where unwind (PEx pe) = [parseErrorToAnnotation pe]
        unwind (SVMEx (e,x)) = [T.pack (show e) <$ x]

parseSource :: T.Text -> T.Text -> Either ParseOrSolidVMError [SourceUnit]
parseSource fileName src = bimap PEx unsourceUnits $ runParser solidityFile "" (T.unpack fileName) (T.unpack src)

parseSourceWithAnnotations :: T.Text -> T.Text -> Either [SourceAnnotation T.Text] [SourceUnit]
parseSourceWithAnnotations = withAnnotations . parseSource

compileSourceNoInheritance :: Map T.Text T.Text -> Either ParseOrSolidVMError CodeCollection
compileSourceNoInheritance initCodeMap = do
  let getNamedContracts fileName src = do
        sourceUnits <- parseSource fileName src
        let pragmas = \case
              Pragma _ n v -> Just (n, v)
              _ -> Nothing
            vmVersion' = if Just ("solidvm", "3.0") `elem` (pragmas <$> sourceUnits) then "svm3.0" else ""
        fmap catMaybes . for sourceUnits $ \case
          NamedXabi name (xabi, parents') -> do
            ctrct <- first SVMEx
                   $ xabiToContract (T.unpack name) (map T.unpack parents') vmVersion' xabi
            pure $ Just (T.unpack name, ctrct)
          _ -> pure Nothing
      throwDuplicate (cName, contract) m = case M.lookup cName m of
        Nothing -> pure $ M.insert cName contract m
        Just _ ->  Left . PEx
                 $ newErrorMessage (Message $ "Duplicate contract found: " ++ cName)
                                   (fromSourcePosition $ _sourceAnnotationStart $ _contractContext contract)
  allContracts <- fmap concat . traverse (uncurry getNamedContracts) $ M.toList initCodeMap
  deduplicatedContracts <- foldrM throwDuplicate M.empty allContracts
  pure $ CodeCollection {
    _contracts = deduplicatedContracts
  }

compileSource :: Map T.Text T.Text -> Either ParseOrSolidVMError CodeCollection
compileSource = applyInheritanceE <=< compileSourceNoInheritance
  where applyInheritanceE = first SVMEx . applyInheritance

compileSourceWithAnnotations :: Map T.Text T.Text -> Either [SourceAnnotation T.Text] CodeCollection
compileSourceWithAnnotations = withAnnotations compileSource

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
          cc = case ecc of
                 Right a -> a
                 Left (PEx p) -> parseError "codeCollectionFromSource" p
                 Left (SVMEx (s, _)) -> throw s
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
              cc = case ecc of
                     Right a -> a
                     Left (PEx p) -> parseError "codeCollectionFromHash" p
                     Left (SVMEx (s, _)) -> throw s
              codeMap' = M.insert hsh cc codeMap
          recordCacheSize $ M.size codeMap'
          liftIO $ writeIORef unsafeCodeMapIORef codeMap'
          return cc
        Nothing -> internalError "unknown code hash" hsh
