{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SolidVM.CodeCollectionDB
  ( CompilationError (..),
    MemCompilerT (..),
    runMemCompilerT,
    parseSource,
    parseSourceWithAnnotations,
    compileSourceNoInheritance,
    compileSource,
    compileSourceWithAnnotations,
    compileSourceWithAnnotationsWithoutImports,
    codeCollectionFromSource,
    codeCollectionFromHash,
  )
where

import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.ChainInfo
import Blockchain.SolidVM.Exception hiding (assert)
import Blockchain.SolidVM.ImportResolver
import Blockchain.SolidVM.Metrics
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq (force)
import Control.Exception
import Control.Lens hiding (Context, assign, bimap, from, to)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.Trans.Except
import qualified Data.Aeson as Aeson
import Data.Bifunctor (bimap, first)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
-- import           System.Clock
-- import qualified Data.Cache                          as DC
import qualified Data.Cache.LRU as LRU
import Data.Default
import Data.Foldable (foldrM)
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe (catMaybes)
import Data.Source
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import SolidVM.CodeCollectionTools
import SolidVM.Model.CodeCollection
import qualified SolidVM.Model.CodeCollection.Def as Def
import SolidVM.Model.SolidString
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.ParserTypes
import qualified SolidVM.Solidity.StaticAnalysis.Functions.ConstantFunctions as ConstantFunctions
import SolidVM.Solidity.StaticAnalysis.Optimizer as O
import qualified SolidVM.Solidity.StaticAnalysis.Statements.MultipleDeclarations as MultipleDeclarations
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker as TypeChecker
import System.IO.Unsafe
import Text.Parsec (runParser)
import Text.Parsec.Error

data CompilationError
  = PEx ParseError
  | IEx T.Text
  | TCEx [SourceAnnotation T.Text]
  | SVMEx (Positioned ((,) SolidException))
  deriving (Show)

newtype MemCompilerT m a = MemCompilerT {unMemCompilerT :: MainChainT (MemAddressStateDB (MemCodeDB m)) a}
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadTrans MemCompilerT where
  lift = MemCompilerT . MainChainT . MemAddressStateDB . lift . MemCodeDB . lift

instance Monad m => (Account `A.Alters` AddressState) (MemCompilerT m) where
  lookup p = MemCompilerT . MainChainT . A.lookup p
  insert p k = MemCompilerT . MainChainT . A.insert p k
  delete p = MemCompilerT . MainChainT . A.delete p

instance Monad m => A.Selectable Account AddressState (MemCompilerT m) where
  select = A.lookup

instance Monad m => (Keccak256 `A.Alters` DBCode) (MemCompilerT m) where
  lookup p = MemCompilerT . MainChainT . MemAddressStateDB . lift . A.lookup p
  insert p k = MemCompilerT . MainChainT . MemAddressStateDB . lift . A.insert p k
  delete p = MemCompilerT . MainChainT . MemAddressStateDB . lift . A.delete p

instance Monad m => A.Selectable Word256 ParentChainIds (MemCompilerT m) where
  select p = MemCompilerT . A.select p

runMemCompilerT :: Monad m => MemCompilerT m a -> m a
runMemCompilerT = runNewMemCodeDB . runNewMemAddressStateDB . runMainChainT . unMemCompilerT

maxCacheSize :: Integer
maxCacheSize = 10

{-# NOINLINE unsafeCodeCacheLRUIORef #-}
unsafeCodeCacheLRUIORef :: IORef (LRU.LRU Keccak256 CodeCollection)
unsafeCodeCacheLRUIORef = unsafePerformIO $ newIORef $ LRU.newLRU (Just maxCacheSize)

withAnnotations :: Monad m => (a -> m (Either CompilationError b)) -> a -> m (Either [SourceAnnotation T.Text] b)
withAnnotations f = fmap (first unwind) . f
  where
    unwind (PEx pe) = [parseErrorToAnnotation pe]
    unwind (IEx t) = [t <$ emptySourceAnnotation]
    unwind (SVMEx (e, x)) = [T.pack (show e) <$ x]
    unwind (TCEx errs) = errs

parseSource :: T.Text -> T.Text -> Either CompilationError [SourceUnit]
parseSource fileName src = bimap PEx unsourceUnits $ runParser solidityFile initialParserState (T.unpack fileName) (T.unpack src)

parseSourceWithAnnotations :: T.Text -> T.Text -> Either [SourceAnnotation T.Text] [SourceUnit]
parseSourceWithAnnotations fileName = runIdentity . withAnnotations (Identity . parseSource fileName)

compileSourceNoInheritance ::
  ( HasCodeDB m,
    A.Selectable Account AddressState m
  ) =>
  Bool ->
  Map T.Text T.Text ->
  m (Either CompilationError CodeCollection)
compileSourceNoInheritance typeCheck initCodeMap = runExceptT $ do
  let getNamedSUnits :: T.Text -> T.Text -> Either CompilationError (Positioned UnresolvedFileUnitsF)
      getNamedSUnits fileName src = do
        sourceUnits <- parseSource fileName src
        foldrM (\u ufu -> maybe (pure ufu) (first IEx . mergeUnresolvedFileUnits ufu) =<< getNameAndUnit sourceUnits u) def sourceUnits

      userDefinedFromFile ss = M.fromList . catMaybes $ (\case (Alias _ alias typ) -> Just (alias, typ); _ -> Nothing) <$> ss
      getNameAndUnit ss = \case
        NamedXabi name (xabi, parents') -> do
          ctrct <-
            first SVMEx $
              xabiToContract (textToLabel name) (map textToLabel parents') (userDefinedFromFile ss) xabi
          pure . Just $ def & ufuUnits . at (textToLabel name) ?~ FUContract ctrct
        FLFunc name fdec ->
          pure . Just $ def & ufuUnits . at name ?~ FUFunction fdec
        FLConstant name cnst ->
          pure . Just $ def & ufuUnits . at (textToLabel name) ?~ FUConstant cnst
        FLStruct name (Def.Struct fs _ a) ->
          let fls = (\(n, t) -> (n, t, a)) <$> fs
           in pure . Just $ def & ufuUnits . at (textToLabel name) ?~ FUStruct fls
        FLEnum name (Def.Enum ns _ a) ->
          let fle = (ns, a)
           in pure . Just $ def & ufuUnits . at (textToLabel name) ?~ FUEnum fle
        FLError name (Def.Error ps _ a) ->
          let fler = (\(n, t) -> (n, t, a)) <$> ps
           in pure . Just $ def & ufuUnits . at (textToLabel name) ?~ FUError fler
        Pragma _ n v ->
          pure . Just $ def & ufuPragmas . at n ?~ v
        Import _ i -> pure . Just $ def & ufuImports .~ [i]
        _ -> pure Nothing
  ufuMap <- except . fmap M.fromList . traverse (\(n, s) -> (n,) <$> getNamedSUnits n s) $ M.toList initCodeMap
  theCC <- withExceptT IEx $ resolveImports (codeCollectionFromHashNoCache False typeCheck) ufuMap
  pure $ force theCC

--- Don't typecheck in Slipstream!!!
compileSource ::
  ( HasCodeDB m,
    A.Selectable Account AddressState m
  ) =>
  Bool ->
  Map T.Text T.Text ->
  m (Either CompilationError CodeCollection)
compileSource typeCheck mTT = do
  eCC <- compileSource' typeCheck mTT
  pure $ first SVMEx . applyInheritanceFunctions =<< eCC

compileSource' ::
  ( HasCodeDB m,
    A.Selectable Account AddressState m
  ) =>
  Bool ->
  Map T.Text T.Text ->
  m (Either CompilationError CodeCollection)
compileSource' typeCheck mTT = do
  let applyInheritanceE = first SVMEx . applyInheritanceNoFunctions
  eCC <- compileSourceNoInheritance typeCheck mTT
  pure $ case applyInheritanceE =<< eCC of
    Right cc -> O.detector <$> if typeCheck
          then typeCheckDetector cc
          else Right cc
    Left x -> Left x
  where
    typeCheckDetector ecc = case TypeChecker.detector ecc <> ConstantFunctions.detector ecc <> MultipleDeclarations.detector ecc of
      [] -> Right ecc
      xs -> Left $ TCEx xs

compileSourceWithAnnotations ::
  ( HasCodeDB m,
    A.Selectable Account AddressState m
  ) =>
  Bool ->
  Map T.Text T.Text ->
  m (Either [SourceAnnotation T.Text] CodeCollection)
compileSourceWithAnnotations typeCheck = withAnnotations (compileSource typeCheck)

compileSourceWithAnnotationsWithoutImports ::
  Bool -> Map T.Text T.Text -> Either [SourceAnnotation T.Text] CodeCollection
compileSourceWithAnnotationsWithoutImports typeCheck = runIdentity . runMemCompilerT . withAnnotations (compileSource typeCheck)

codeCollectionFromSource ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Account AddressState m
    -- , HasCodeCollectionDB m
  ) =>
  Bool ->
  B.ByteString ->
  m (Keccak256, CodeCollection)
codeCollectionFromSource typeCheck initCode = do
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
  codeCache <- liftIO $ readIORef unsafeCodeCacheLRUIORef
  case LRU.lookup hsh codeCache of
    (newCache, (Just cc)) -> do
      recordCacheEvent CacheHit
      liftIO $ writeIORef unsafeCodeCacheLRUIORef newCache
      return (hsh, cc)
    (_, Nothing) -> do
      recordCacheEvent StorageWrite
      hsh' <- addCode SolidVM canonicalInitCode
      ecc <- compileSource typeCheck initMap
      let cc = case ecc of
            Right a -> a
            Left (PEx p) -> parseError "codeCollectionFromSource" p
            Left (IEx p) -> typeError "codeCollectionFromSource" p
            Left (SVMEx (s, _)) -> throw s
            Left (TCEx xs) -> typeError "Typechecker" (typeErrorToAnnotation xs)
      liftIO $ modifyIORef' unsafeCodeCacheLRUIORef (LRU.insert hsh cc)
      return $ assert (hsh == hsh') (hsh, cc)

codeCollectionFromHash ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Account AddressState m
    -- , HasCodeCollectionDB m
  ) =>
  Bool ->
  Keccak256 ->
  m CodeCollection
codeCollectionFromHash typeCheck hsh = do
  codeCache <- liftIO $ readIORef unsafeCodeCacheLRUIORef
  case LRU.lookup hsh codeCache of
    (newCache, (Just cc)) -> do
      recordCacheEvent CacheHit
      liftIO $ writeIORef unsafeCodeCacheLRUIORef newCache
      return cc
    (_, Nothing) -> do
      recordCacheEvent CacheMiss
      cc <- codeCollectionFromHashNoCache True typeCheck hsh
      liftIO $ modifyIORef' unsafeCodeCacheLRUIORef (LRU.insert hsh cc)
      return cc

codeCollectionFromHashNoCache ::
  ( HasCodeDB m,
    A.Selectable Account AddressState m
  ) =>
  Bool ->
  Bool ->
  Keccak256 ->
  m CodeCollection
codeCollectionFromHashNoCache mergeFuncs typeCheck hsh =
  getCode hsh >>= \case
    Nothing -> internalError "unknown code hash" hsh
    Just (_, initCode) -> do
      let initMap = case Aeson.decode $ BL.fromStrict initCode of
            Just l -> M.fromList l
            Nothing -> M.singleton T.empty (decodeUtf8 initCode)
      ecc <- (if mergeFuncs then compileSource else compileSource') typeCheck initMap
      case ecc of
        Right a -> pure a
        Left (PEx p) -> parseError "codeCollectionFromHash" p
        Left (IEx p) -> typeError "codeCollectionFromHash" p
        Left (SVMEx (s, _)) -> throw s
        Left (TCEx xs) -> typeError "codeCollectionFromHash" (show xs)
