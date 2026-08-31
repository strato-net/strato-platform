{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SolidVM.CodeCollectionDB
  ( CompilationError (..),
    MemCompilerT (..),
    runMemCompilerT,
    parseSource,
    parseSourceUncached,
    parseSourceUnitSlices,
    parseSourceWithAnnotations,
    compileSourceNoInheritance,
    compileSource,
    compileSourceWithAnnotations,
    compileSourceWithAnnotationsWithoutImports,
    prewarmCodeCollectionFromSource,
    codeCollectionFromSource,
    codeCollectionFromHash,
  )
where

import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.Data.AddressStateDB
import Blockchain.PhaseProfile
import Blockchain.SolidVM.Exception hiding (assert)
import Blockchain.SolidVM.ImportResolver
import Blockchain.SolidVM.Metrics
import Blockchain.Strato.Model.Address
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
import Data.Default
import Data.Foldable (foldrM)
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe (catMaybes)
import qualified Data.Sequence as Q
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
  | IEx (SourceAnnotation T.Text)
  | TCEx [SourceAnnotation T.Text]
  | SVMEx (Positioned ((,) SolidException))
  deriving (Show)

newtype MemCompilerT m a = MemCompilerT {unMemCompilerT :: MainChainT (MemAddressStateDB (MemCodeDB m)) a}
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadTrans MemCompilerT where
  lift = MemCompilerT . MainChainT . MemAddressStateDB . lift . MemCodeDB . lift

instance {-# OVERLAPPING #-} Monad m => (Address `A.Alters` AddressState) (MemCompilerT m) where
  lookup p = MemCompilerT . MainChainT . A.lookup p
  insert p k = MemCompilerT . MainChainT . A.insert p k
  delete p = MemCompilerT . MainChainT . A.delete p

instance {-# OVERLAPPING #-} Monad m => A.Selectable Address AddressState (MemCompilerT m) where
  select = A.lookup

instance Monad m => (Keccak256 `A.Alters` DBCode) (MemCompilerT m) where
  lookup p = MemCompilerT . MainChainT . MemAddressStateDB . lift . A.lookup p
  insert p k = MemCompilerT . MainChainT . MemAddressStateDB . lift . A.insert p k
  delete p = MemCompilerT . MainChainT . MemAddressStateDB . lift . A.delete p

runMemCompilerT :: Monad m => MemCompilerT m a -> m a
runMemCompilerT = runNewMemCodeDB . runNewMemAddressStateDB . runMainChainT . unMemCompilerT

-- Apply/catchup touches far more than 10 contracts (DEC1DE, USDST, voucher,
-- oracles, user code). A 10-entry LRU evicts and re-typechecks on the hot path.
{-# NOINLINE unsafeCodeCacheIORef #-}
unsafeCodeCacheIORef :: IORef (M.Map Keccak256 CodeCollection)
unsafeCodeCacheIORef = unsafePerformIO $ newIORef M.empty

-- Future creation transactions in an incoming VM batch can be compiled before
-- ordered execution reaches them whenever all of their imports are contained
-- in the payload. Keep those speculative results separate from the normal code
-- cache: a normal cache hit intentionally skips 'addCode', whereas consuming a
-- precompiled creation must still perform that canonical CodeDB write.
{-# NOINLINE precompiledSourceCache #-}
precompiledSourceCache :: IORef (M.Map (Bool, Bool, Keccak256) CodeCollection, Q.Seq (Bool, Bool, Keccak256))
precompiledSourceCache = unsafePerformIO $ newIORef (M.empty, Q.empty)

precompiledSourceCacheLimit :: Int
precompiledSourceCacheLimit = 128

withAnnotations :: Monad m => (a -> m (Either CompilationError b)) -> a -> m (Either [SourceAnnotation T.Text] b)
withAnnotations f = fmap (first unwind) . f
  where
    unwind (PEx pe) = [parseErrorToAnnotation pe]
    unwind (IEx t) = [t]
    unwind (SVMEx (e, x)) = [T.pack (show e) <$ x]
    unwind (TCEx errs) = errs

parseSource :: T.Text -> T.Text -> Either CompilationError [SourceUnit]
parseSource fileName src = unsafePerformIO $ do
  let key = (fileName, hash $ encodeUtf8 src)
  (cached, _) <- readIORef sourceParseCache
  case M.lookup key cached of
    Just units -> pure $ Right units
    Nothing -> do
      case parseSourceUncached fileName src of
        Left err -> pure $ Left err
        Right units -> do
          forced <- evaluate $ force units
          atomicModifyIORef' sourceParseCache $ \(entries, order) ->
            case M.lookup key entries of
              Just existing -> ((entries, order), Right existing)
              Nothing ->
                let entries' = M.insert key forced entries
                    order' = order Q.|> key
                    (boundedEntries, boundedOrder) =
                      if M.size entries' <= sourceParseCacheLimit
                        then (entries', order')
                        else case Q.viewl order' of
                          oldest Q.:< rest -> (M.delete oldest entries', rest)
                          Q.EmptyL -> (entries', order')
                 in ((boundedEntries, boundedOrder), Right forced)

{-# NOINLINE sourceParseCache #-}
sourceParseCache :: IORef (M.Map (T.Text, Keccak256) [SourceUnit], Q.Seq (T.Text, Keccak256))
sourceParseCache = unsafePerformIO $ newIORef (M.empty, Q.empty)

sourceParseCacheLimit :: Int
sourceParseCacheLimit = 1024

parseSourceUncached :: T.Text -> T.Text -> Either CompilationError [SourceUnit]
parseSourceUncached fileName src = bimap PEx unsourceUnits $ runParser solidityFileUncached initialParserState (T.unpack fileName) (T.unpack src)

-- | Recover the exact source consumed by each top-level parser unit. This is
-- exposed for replay diagnostics; production compilation still uses
-- 'parseSource'.
parseSourceUnitSlices :: T.Text -> T.Text -> Either CompilationError [(String, T.Text)]
parseSourceUnitSlices fileName src = do
  spanned <- first PEx $ runParser solidityFileSpanned initialParserState (T.unpack fileName) (T.unpack src)
  let lineStarts = scanl (+) 0 $ map ((+ 1) . T.length) (T.splitOn (T.singleton '\n') src)
      offset pos =
        let lineIndex = max 0 (_sourcePositionLine pos - 1)
            columnIndex = max 0 (_sourcePositionColumn pos - 1)
         in (lineStarts !! lineIndex) + columnIndex
      exactSlice (ann, unit) =
        let start = offset $ _sourceAnnotationStart ann
            end = offset $ _sourceAnnotationEnd ann
         in (sourceUnitLabel unit, T.take (end - start) $ T.drop start src)
  pure $ map exactSlice spanned
  where
    sourceUnitLabel = \case
      Pragma _ name _ -> "pragma:" ++ name
      Import _ _ -> "import"
      Alias _ name _ -> "alias:" ++ name
      FLContract contract -> "contract:" ++ labelToString (_contractName contract)
      FLFunc name _ -> "function:" ++ name
      FLConstant name _ -> "constant:" ++ T.unpack name
      FLStruct name _ -> "struct:" ++ T.unpack name
      FLEnum name _ -> "enum:" ++ T.unpack name
      FLError name _ -> "error:" ++ T.unpack name
      FLUsing _ -> "using"
      DummySourceUnit -> "dummy"

parseSourceWithAnnotations :: T.Text -> T.Text -> Either [SourceAnnotation T.Text] [SourceUnit]
parseSourceWithAnnotations fileName = runIdentity . withAnnotations (Identity . parseSource fileName)

compileSourceNoInheritance ::
  ( HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  Bool ->
  Bool ->
  Map T.Text T.Text ->
  m (Either CompilationError CodeCollection)
compileSourceNoInheritance isRunningTests typeCheck initCodeMap = runExceptT $ do
  let getNamedSUnits :: T.Text -> T.Text -> Either CompilationError (Positioned UnresolvedFileUnitsF)
      getNamedSUnits fileName src = do
        sourceUnits <- parseSource fileName src
        foldrM (\u ufu -> maybe (pure ufu) (first (IEx . (<$ (def :: SourceAnnotation ()))) . mergeUnresolvedFileUnits ufu) =<< getNameAndUnit sourceUnits u) def sourceUnits

      userDefinedFromFile ss = M.fromList . catMaybes $ (\case (Alias _ alias typ) -> Just (alias, typ); _ -> Nothing) <$> ss
      getNameAndUnit ss = \case
        FLContract c -> do
          let ctrct = c & userDefined .~ userDefinedFromFile ss
          pure . Just $ def & ufuUnits . at (_contractName c) ?~ FUContract ctrct
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
        FLUsing u -> pure . Just $ def & ufuUnits . at (show u) ?~ FUUsing u
        Pragma _ n v ->
          pure . Just $ def & ufuPragmas . at n ?~ v
        Import _ i -> pure . Just $ def & ufuImports .~ [i]
        _ -> pure Nothing
  ufuMap <- except . fmap M.fromList . traverse (\(n, s) -> (n,) <$> getNamedSUnits n s) $ M.toList initCodeMap
  theCC <- withExceptT (\(x,t) -> IEx $ t <$ x) $ resolveImports (codeCollectionFromHashNoCache isRunningTests False typeCheck) (\f -> either (const Nothing) Just . getNamedSUnits f) ufuMap
  pure $ force theCC

--- Don't typecheck in Slipstream!!!
compileSource ::
  ( HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  Bool ->
  Bool ->
  Map T.Text T.Text ->
  m (Either CompilationError CodeCollection)
compileSource isRunningTests typeCheck mTT = do
  eCC <- compileSource' isRunningTests typeCheck mTT
  pure $ first SVMEx . applyInheritanceFunctions =<< eCC

-- | The production compilation pipeline with profiler-only boundaries around
-- its expensive cold stages. Keeping this separate preserves the pure compiler
-- API used by tests and Slipstream.
compileSourceProfiled ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  Bool ->
  Bool ->
  Bool ->
  Map T.Text T.Text ->
  m (Either CompilationError CodeCollection)
compileSourceProfiled mergeFuncs isRunningTests typeCheck sources = do
  parsed <- profileRunCodeChild
    RunCodeCallColdParseImportCollection
    RunCodeCreationColdParseImportCollection $
      compileSourceNoInheritance isRunningTests typeCheck sources
  checked <- profileRunCodeChild
    RunCodeCallColdInheritanceTypecheckOptimize
    RunCodeCreationColdInheritanceTypecheckOptimize $
      forceRight $ inheritanceTypecheck =<< parsed
  if mergeFuncs
    then profileRunCodeChild
      RunCodeCallColdFunctionInheritance
      RunCodeCreationColdFunctionInheritance $
        forceRight $ first SVMEx . applyInheritanceFunctions =<< checked
    else pure checked
  where
    inheritanceTypecheck cc = do
      inherited <- first SVMEx $ applyInheritanceNoFunctions cc
      checked <-
        if typeCheck
          then case TypeChecker.detector' isRunningTests inherited <> ConstantFunctions.detector inherited <> MultipleDeclarations.detector inherited of
            [] -> Right inherited
            xs -> Left $ TCEx xs
          else Right inherited
      pure $ O.detector checked

    forceRight (Left err) = pure $ Left err
    forceRight (Right cc) = Right <$> liftIO (evaluate $ force cc)

compileSource' ::
  ( HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  Bool ->
  Bool ->
  Map T.Text T.Text ->
  m (Either CompilationError CodeCollection)
compileSource' isRunningTests typeCheck mTT = do
  let applyInheritanceE = first SVMEx . applyInheritanceNoFunctions
  eCC <- compileSourceNoInheritance isRunningTests typeCheck mTT
  pure $ case applyInheritanceE =<< eCC of
    Right cc -> O.detector <$> if typeCheck
          then typeCheckDetector cc
          else Right cc
    Left x -> Left x
  where
    typeCheckDetector ecc = case TypeChecker.detector' isRunningTests ecc <> ConstantFunctions.detector ecc <> MultipleDeclarations.detector ecc of
      [] -> Right ecc
      xs -> Left $ TCEx xs

compileSourceWithAnnotations ::
  ( HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  Bool ->
  Bool ->
  Map T.Text T.Text ->
  m (Either [SourceAnnotation T.Text] CodeCollection)
compileSourceWithAnnotations isRunningTests typeCheck =
  withAnnotations (compileSource isRunningTests typeCheck)

compileSourceWithAnnotationsWithoutImports ::
  Bool -> Bool -> Map T.Text T.Text -> Either [SourceAnnotation T.Text] CodeCollection
compileSourceWithAnnotationsWithoutImports isRunningTests typeCheck =
  runIdentity . runMemCompilerT . withAnnotations (compileSource isRunningTests typeCheck)

-- | Speculatively compile a creation payload using empty in-memory external
-- state. This succeeds exactly when import resolution does not need the live
-- AddressState/CodeDB. Failures and exceptions are ignored by the caller; the
-- authoritative ordered path will reproduce them against the real state.
prewarmCodeCollectionFromSource :: Bool -> Bool -> B.ByteString -> IO ()
prewarmCodeCollectionFromSource isRunningTests typeCheck initCode = do
  let (initMap, _, hsh) = decodeInitCode initCode
      key = (isRunningTests, typeCheck, hsh)
  (cached, _) <- readIORef precompiledSourceCache
  case M.lookup key cached of
    Just _ -> pure ()
    Nothing -> do
      let compiled = runIdentity . runMemCompilerT $ compileSource isRunningTests typeCheck initMap
      attempted <- try $ evaluate compiled
      case attempted of
        Left (_ :: SomeException) -> pure ()
        Right (Left _) -> pure ()
        Right (Right cc) -> do
          forced <- try $ evaluate $ force cc
          case forced of
            Left (_ :: SomeException) -> pure ()
            Right cc' ->
              atomicModifyIORef' precompiledSourceCache $ \(entries, order) ->
                case M.lookup key entries of
                  Just _ -> ((entries, order), ())
                  Nothing ->
                    let entries' = M.insert key cc' entries
                        order' = order Q.|> key
                        (boundedEntries, boundedOrder) =
                          if M.size entries' <= precompiledSourceCacheLimit
                            then (entries', order')
                            else case Q.viewl order' of
                              oldest Q.:< rest -> (M.delete oldest entries', rest)
                              Q.EmptyL -> (entries', order')
                     in ((boundedEntries, boundedOrder), ())

decodeInitCode :: B.ByteString -> (Map T.Text T.Text, B.ByteString, Keccak256)
decodeInitCode initCode =
  let initList = case Aeson.decode $ BL.fromStrict initCode of
        Just l -> l
        Nothing -> case Aeson.decode $ BL.fromStrict initCode of
          Just m -> M.toList m
          Nothing -> [(T.empty, decodeUtf8 initCode)] -- for backwards compatibility
      initMap = M.fromList initList
      canonicalInitCode = case initList of
        [(t, src)] | T.null t -> encodeUtf8 src -- for backwards compatibility
        _ -> BL.toStrict $ Aeson.encode initList
   in (initMap, canonicalInitCode, hash canonicalInitCode)

takePrecompiledSource :: Bool -> Bool -> Keccak256 -> IO (Maybe CodeCollection)
takePrecompiledSource isRunningTests typeCheck hsh =
  atomicModifyIORef' precompiledSourceCache $ \(entries, order) ->
    let key = (isRunningTests, typeCheck, hsh)
     in ((M.delete key entries, Q.filter (/= key) order), M.lookup key entries)

codeCollectionFromSource ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
    -- , HasCodeCollectionDB m
  ) =>
  Bool ->
  Bool ->
  B.ByteString ->
  m (Keccak256, CodeCollection)
codeCollectionFromSource isRunningTests typeCheck initCode = do
  let (initMap, canonicalInitCode, hsh) = decodeInitCode initCode
  cached <- profileRunCodeChild
    RunCodeCallCodeCacheLookup
    RunCodeCreationCodeCacheLookup $ do
      codeCache <- liftIO $ readIORef unsafeCodeCacheIORef
      liftIO $ evaluate $ M.lookup hsh codeCache
  case cached of
    Just cc -> do
      recordCacheEvent CacheHit
      return (hsh, cc)
    Nothing -> profileRunCodeChild
      RunCodeCallColdCodeLoadCompileTypecheck
      RunCodeCreationColdCodeLoadCompileTypecheck $ do
        recordCacheEvent StorageWrite
        hsh' <- profileRunCodeChild
          RunCodeCallColdCodeDatabaseIO
          RunCodeCreationColdCodeDatabaseIO $
            addCode canonicalInitCode
        precompiled <- liftIO $ takePrecompiledSource isRunningTests typeCheck hsh
        cc <- case precompiled of
          Just a -> pure a
          Nothing -> do
            ecc <-
              if runCodeDetailEnabled
                then compileSourceProfiled True isRunningTests typeCheck initMap
                else compileSource isRunningTests typeCheck initMap
            pure $ case ecc of
              Right a -> a
              Left (PEx p) -> parseError "codeCollectionFromSource" p
              Left (IEx p) -> typeError "codeCollectionFromSource" $ show p
              Left (SVMEx (s, _)) -> throw s
              Left (TCEx xs) -> typeError "Typechecker" $ T.unpack (typeErrorToAnnotation xs)
        liftIO $ modifyIORef' unsafeCodeCacheIORef (M.insert hsh cc)
        return $ assert (hsh == hsh') (hsh, cc)

codeCollectionFromHash ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
    -- , HasCodeCollectionDB m
  ) =>
  Bool ->
  Bool ->
  Keccak256 ->
  m CodeCollection
codeCollectionFromHash isRunningTests typeCheck hsh = do
  cached <- profileRunCodeChild
    RunCodeCallCodeCacheLookup
    RunCodeCreationCodeCacheLookup $ do
      codeCache <- liftIO $ readIORef unsafeCodeCacheIORef
      liftIO $ evaluate $ M.lookup hsh codeCache
  case cached of
    Just cc -> do
      recordCacheEvent CacheHit
      return cc
    Nothing -> do
      precompiled <- liftIO $ takePrecompiledSource isRunningTests typeCheck hsh
      cc <- case precompiled of
        Just a -> recordCacheEvent CacheHit >> pure a
        Nothing -> do
          recordCacheEvent CacheMiss
          profileRunCodeChild
            RunCodeCallColdCodeLoadCompileTypecheck
            RunCodeCreationColdCodeLoadCompileTypecheck $
              if runCodeDetailEnabled
                then codeCollectionFromHashNoCacheProfiled isRunningTests True typeCheck hsh
                else codeCollectionFromHashNoCache isRunningTests True typeCheck hsh
      liftIO $ modifyIORef' unsafeCodeCacheIORef (M.insert hsh cc)
      return cc

codeCollectionFromHashNoCache ::
  ( HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  Bool ->
  Bool ->
  Bool ->
  Keccak256 ->
  m CodeCollection
codeCollectionFromHashNoCache isRunningTests mergeFuncs typeCheck hsh =
  getCode hsh >>= \case
    Nothing -> internalError "unknown code hash" hsh
    Just initCode -> do
      let initMap = case Aeson.decode $ BL.fromStrict initCode of
            Just l -> M.fromList l
            Nothing -> M.singleton T.empty (decodeUtf8 initCode)
      ecc <- (if mergeFuncs then compileSource else compileSource') isRunningTests typeCheck initMap
      case ecc of
        Right a -> pure a
        Left (PEx p) -> parseError "codeCollectionFromHash" p
        Left (IEx p) -> typeError "codeCollectionFromHash" $ show p
        Left (SVMEx (s, _)) -> throw s
        Left (TCEx xs) -> typeError "codeCollectionFromHash" (show xs)

codeCollectionFromHashNoCacheProfiled ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  Bool ->
  Bool ->
  Bool ->
  Keccak256 ->
  m CodeCollection
codeCollectionFromHashNoCacheProfiled isRunningTests mergeFuncs typeCheck hsh =
  profileRunCodeChild
    RunCodeCallColdCodeDatabaseIO
    RunCodeCreationColdCodeDatabaseIO
    (getCode hsh) >>= \case
      Nothing -> internalError "unknown code hash" hsh
      Just initCode -> do
        let initMap = case Aeson.decode $ BL.fromStrict initCode of
              Just l -> M.fromList l
              Nothing -> M.singleton T.empty (decodeUtf8 initCode)
        ecc <- compileSourceProfiled mergeFuncs isRunningTests typeCheck initMap
        case ecc of
          Right a -> pure a
          Left (PEx p) -> parseError "codeCollectionFromHash" p
          Left (IEx p) -> typeError "codeCollectionFromHash" $ show p
          Left (SVMEx (s, _)) -> throw s
          Left (TCEx xs) -> typeError "codeCollectionFromHash" (show xs)
