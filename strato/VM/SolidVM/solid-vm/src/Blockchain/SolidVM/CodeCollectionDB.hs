{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE RankNTypes #-}
module Blockchain.SolidVM.CodeCollectionDB
  ( 
    compileSource
  , compileSourceWithAnnotations
  , codeCollectionFromSource
  , codeCollectionFromHash
  ) where

import           Control.Exception
import           Control.Monad                        ((<=<))
import           Control.Monad.IO.Class
import           Control.Lens                         hiding (assign, from, to, bimap, Context)
import qualified Data.Aeson                           as Aeson
import           Data.Bifunctor                       (first)
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           Data.Source
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (decodeUtf8, encodeUtf8)
import           System.IO.Unsafe

import           Blockchain.DB.CodeDB
import           Blockchain.SolidVM.Exception         hiding (assert)
import           Blockchain.SolidVM.Metrics
import           Blockchain.Strato.Model.Keccak256

import           SolidVM.Model.CodeCollection
import           SolidVM.Solidity.Parse
import           SolidVM.Solidity.StaticAnalysis.Typechecker as TC

{-# NOINLINE unsafeCodeMapIORef #-}
unsafeCodeMapIORef :: IORef (Map Keccak256 CodeCollection)
unsafeCodeMapIORef = unsafePerformIO $ newIORef M.empty

withAnnotations :: (a -> Either ParseTypeCheckOrSolidVMError b) -> a -> Either [SourceAnnotation T.Text] b
withAnnotations f = first unwind . f
  where unwind (PEx pe) = [parseErrorToAnnotation pe]
        unwind (SVMEx (e,x)) = [T.pack (show e) <$ x]
        unwind (TCEx errs) = errs

hasSvm3_2 :: CodeCollection -> Bool
hasSvm3_2 cc = any (=="svm3.2") vmVers
  where
    contractList = map snd $ M.toList (cc ^. contracts )
    vmVers = map (^. vmVersion ) contractList

compileSource :: Map T.Text T.Text -> Either ParseTypeCheckOrSolidVMError CodeCollection
compileSource mTT = do
  let applyInheritanceE = first SVMEx . applyInheritance
  case ((applyInheritanceE <=< compileSourceNoInheritance) mTT) of   
    Right cc -> if hasSvm3_2 cc then typeCheckDetector cc else Right cc
    Left x -> Left x
    where 
      typeCheckDetector ecc = case TC.detector ecc of
        [] -> Right ecc
        xs -> Left $ TCEx xs

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
                 Left (TCEx xs) -> typeError "Typechecker" (typeErrorToAnnotation xs)
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
                     Left (TCEx xs) -> typeError "codeCollectionFromSource" (show xs)
              codeMap' = M.insert hsh cc codeMap
          recordCacheSize $ M.size codeMap'
          liftIO $ writeIORef unsafeCodeMapIORef codeMap'
          return cc
        Nothing -> internalError "unknown code hash" hsh
