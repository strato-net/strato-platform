{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SolidVM.ImportResolver
  ( FileUnitF (..),
    FileUnitMapF,
    UnresolvedFileUnitsF (..),
    ufuImports,
    ufuPragmas,
    ufuUnits,
    emptyUnresolvedFileUnits,
    mergeUnresolvedFileUnitsIgnoreDuplicates,
    mergeUnresolvedFileUnits,
    FileUnitsF (..),
    fuPragmas,
    fuUnits,
    emptyFileUnits,
    mergeFileUnits,
    resolveImports,
  )
where

import qualified Control.Monad.Change.Alter           as A
import           Control.Monad.Trans.Class            (lift)
import           Control.Monad.Trans.Except
import           Control.Lens                         hiding (assign, from, to, bimap, Context)
import           Data.Default
import           Data.Foldable                        (foldl', foldrM)
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           Data.Maybe                           (fromJust, fromMaybe)
import qualified Data.Set                             as S
import           Data.Text                            (Text)
import qualified Data.Text                            as T

import           Blockchain.Data.AddressStateDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Keccak256

import           SolidVM.Model.CodeCollection
import           SolidVM.Model.SolidString
import           SolidVM.Solidity.Parse.UnParser (unparseExpression)

type EndoM m a = a -> m a

data FileUnitF a
  = FUContract (ContractF a)
  | FUConstant (ConstantDeclF a)
  | FUStruct [(SolidString, FieldType, a)]
  | FUEnum ([SolidString], a)
  | FUFunction (FuncF a)
  | FUError [(SolidString, IndexedType, a)]
  deriving (Show)

type FileUnitMapF a = Map SolidString (FileUnitF a)

data UnresolvedFileUnitsF a = UFU
  { _ufuImports :: [FileImportF a],
    _ufuPragmas :: Map String String,
    _ufuUnits :: FileUnitMapF a
  }

makeLenses ''UnresolvedFileUnitsF

emptyUnresolvedFileUnits :: UnresolvedFileUnitsF a
emptyUnresolvedFileUnits = UFU [] M.empty M.empty

instance Default (UnresolvedFileUnitsF a) where
  def = emptyUnresolvedFileUnits

mergeUnresolvedFileUnitsIgnoreDuplicates :: UnresolvedFileUnitsF a -> UnresolvedFileUnitsF a -> UnresolvedFileUnitsF a
mergeUnresolvedFileUnitsIgnoreDuplicates (UFU i p u) (UFU j q v) = UFU (i <> j) (p <> q) (u <> v)

mergeUnresolvedFileUnits :: Show a => UnresolvedFileUnitsF a -> UnresolvedFileUnitsF a -> Either Text (UnresolvedFileUnitsF a)
mergeUnresolvedFileUnits (UFU i p u) (UFU j q v) = do
  -- Checking if there are duplicates and if there are,
  -- determine if they are functions that are overloadable.
  let duplicates = M.toList $ M.intersection u v
      overloads = map (\(k, val) -> do
                        let otherVal = fromJust $ M.lookup k v
                          in case (val, otherVal) of
                               (FUFunction v1, FUFunction v2) -> if (_funcArgs v1) == (_funcArgs v2)
                                                                   then (False, k, FUFunction v1)
                                                                   else (True, k, FUFunction v1{_funcOverload = (_funcOverload v1) ++ [v2]})
                               _ -> (False, k, val)
                          ) duplicates
      mergeAsOverloads = all (\(b, _, _) -> b) overloads
      newFileUnits = foldl' (\accumMap (_, k, newVal) -> M.insert k newVal accumMap) u overloads
  if null duplicates
    then Right $ UFU (i <> j) (p <> q) (u <> v)
    else if mergeAsOverloads
           then Right $ UFU (i <> j) (p <> q) (newFileUnits)
           else Left . T.pack $ "Duplicate values: " ++ show duplicates

instance Semigroup (UnresolvedFileUnitsF a) where
  (<>) = mergeUnresolvedFileUnitsIgnoreDuplicates

instance Monoid (UnresolvedFileUnitsF a) where
  mempty = def
  mappend = (<>)

data FileUnitsF a = FileUnits
  { _fuPragmas :: Map String String,
    _fuUnits :: Map (Maybe Text) (FileUnitMapF a)
  }

makeLenses ''FileUnitsF

emptyFileUnits :: FileUnitsF a
emptyFileUnits = FileUnits M.empty M.empty

instance Default (FileUnitsF a) where
  def = emptyFileUnits

mergeFileUnits :: FileUnitsF a -> FileUnitsF a -> FileUnitsF a
mergeFileUnits (FileUnits p u) (FileUnits q v) = FileUnits (p <> q) (u <> v)

instance Semigroup (FileUnitsF a) where
  (<>) = mergeFileUnits

instance Monoid (FileUnitsF a) where
  mempty = def
  mappend = (<>)

type ImportMapF a = Map Text (Either (UnresolvedFileUnitsF a) (FileUnitsF a))

resolveImports ::
  ( A.Selectable Account AddressState m,
    Show a,
    Ord a,
    Default a
  ) =>
  (Keccak256 -> m (CodeCollectionF a)) ->
  Map Text (UnresolvedFileUnitsF a) ->
  ExceptT Text m (CodeCollectionF a)
resolveImports getCCFromHash m = do
  m' <- fmap snd . foldrM (resolveFile getCCFromHash) (S.empty, Left <$> m) . map lit $ M.keys m
  m'' <- flip M.traverseWithKey m' $ \k v -> case v of
    Left _ -> throwE $ "Failed to resolve imports for file: " <> k
    Right r -> pure r
  pure . foldMap fileUnitsToCodeCollection $ M.elems m''

resolveFile ::
  ( A.Selectable Account AddressState m,
    Show a,
    Ord a,
    Default a
  ) =>
  (Keccak256 -> m (CodeCollectionF a)) ->
  ExpressionF a ->
  EndoM (ExceptT Text m) (S.Set Text, ImportMapF a)
resolveFile getCCFromHash expr (seen, resolved) =
  if tShowExpr expr `S.member` seen
    then throwE . T.concat $ "Circular reference identified: " : S.toList seen
    else case expr of
      AccountLiteral _ namedAcct ->
        if namedAcct ^. namedAccountChainId == MainChain || namedAcct ^. namedAccountChainId == UnspecifiedChain
          then do
            let acct = namedAccountToAccount Nothing namedAcct
            lift (A.select (A.Proxy @AddressState) acct) >>= \case
              Nothing -> pure (seen, resolved)
              Just AddressState {..} ->
                lift (runMainChainT $ resolveCodePtr Nothing addressStateCodeHash) >>= \case
                  Just (SolidVMCode _ ch) -> do
                    rfu <- lift $ codeCollectionToFileUnits (Just acct) <$> getCCFromHash ch
                    pure (seen, M.insert (tShowExpr expr) (Right rfu) resolved)
                  Just (ExternallyOwned _) -> throwE . T.pack $ "Account referenced in import contains EVM code: " ++ show acct
                  _ -> throwE . T.pack $ "Account referenced in import could not be resolved: " ++ show acct
          else throwE "Account imports can only come from the main chain"
      StringLiteral _ fileName' ->
        let fileName = T.pack fileName'
         in case M.lookup fileName resolved of
              Nothing -> throwE $ "Could not find file by name of " <> fileName
              Just (Right _) -> pure (seen, resolved)
              Just (Left l) ->
                let eResolved' = snd <$> foldrM (doResolve getCCFromHash fileName) (S.insert fileName seen, resolved) (l ^. ufuImports)
                 in fmap (seen,) . flip fmap eResolved' . flip M.adjust fileName $ \case
                      Left u -> Right . FileUnits (u ^. ufuPragmas) $ M.singleton Nothing (u ^. ufuUnits)
                      Right r -> Right . FileUnits (r ^. fuPragmas) $ M.singleton Nothing (l ^. ufuUnits) <> (r ^. fuUnits)
      _ -> throwE . T.pack $ "Unsupported expression in import: " ++ unparseExpression expr

codeCollectionToFileUnits :: Maybe Account -> CodeCollectionF a -> FileUnitsF a
codeCollectionToFileUnits from CodeCollection {..} =
  let units =
        (FUContract . (importedFrom %~ maybe from Just) <$> _contracts)
          <> (FUConstant <$> _flConstants)
          <> (FUStruct <$> _flStructs)
          <> (FUEnum <$> _flEnums)
          <> (FUFunction <$> _flFuncs)
          <> (FUError <$> _flErrors)
   in FileUnits (M.fromList _pragmas) $ M.singleton Nothing units

fileUnitsToCodeCollection :: FileUnitsF a -> CodeCollectionF a
fileUnitsToCodeCollection (FileUnits ps us) =
  foldr addUnit (def & pragmas .~ M.toList ps) . concat $ M.toList <$> M.elems us
  where
    addUnit (n, (FUContract c)) = contracts . at n ?~ c
    addUnit (n, (FUConstant c)) = flConstants . at n ?~ c
    addUnit (n, (FUStruct s)) = flStructs . at n ?~ s
    addUnit (n, (FUEnum e)) = flEnums . at n ?~ e
    addUnit (n, (FUFunction f)) = flFuncs . at n ?~ f
    addUnit (n, (FUError e)) = flErrors . at n ?~ e

doResolve ::
  ( A.Selectable Account AddressState m,
    Show a,
    Ord a,
    Default a
  ) =>
  (Keccak256 -> m (CodeCollectionF a)) ->
  Text ->
  FileImportF a ->
  EndoM (ExceptT Text m) (S.Set Text, ImportMapF a)
doResolve f fileName imp (seen, resolved) = case imp of
  Simple path _ -> resolvePath fileName path >>= \p -> resolveFile f p (seen, resolved) >>= \(_, r') -> (seen,) <$> updateResolved fileName (tShowExpr p) "" r'
  Qualified path alias _ -> resolvePath fileName path >>= \p -> resolveFile f p (seen, resolved) >>= \(_, r') -> (seen,) <$> updateResolved fileName (tShowExpr p) alias r'
  Braced items path _ -> resolvePath fileName path >>= \p -> resolveFile f p (seen, resolved) >>= \(_, r') -> (seen,) <$> foldrM (updateSingleItem fileName $ tShowExpr p) r' items

resolvePath :: Monad m => Text -> EndoM (ExceptT Text m) (ExpressionF a)
resolvePath fileName (StringLiteral a path') =
  let path = T.pack path'
      fileDir = tail . reverse $ T.splitOn "/" fileName
      pathDir = T.splitOn "/" path
   in maybe (throwE $ "Could not resolve path: " <> path) (pure . lit' a) $ resolvePath' fileDir pathDir
resolvePath _ expr = pure expr

resolvePath' :: [Text] -> [Text] -> Maybe Text
resolvePath' fileDir pathDir = case pathDir of
  ("" : _) -> Just $ T.intercalate "/" pathDir -- root directory
  (".." : pathRest) -> case fileDir of
    [] -> Nothing
    (_ : fileRest) -> resolvePath' fileRest pathRest
  ("." : pathRest) -> resolvePath' fileDir pathRest
  [] -> Nothing
  pathRest -> Just . T.intercalate "/" $ reverse fileDir ++ pathRest

updateResolved :: (Monad m, Show a) => Text -> Text -> Text -> EndoM (ExceptT Text m) (ImportMapF a)
updateResolved fileName path qualifier resolved = case M.lookup path resolved of
  Just (Right (FileUnits _ us)) -> do
    let natives = fromMaybe M.empty $ M.lookup Nothing us
        fUnits = M.lookup fileName resolved
    fUnits' <- case fUnits of
      Just (Left (UFU _ ps us')) -> pure . Right . FileUnits ps $ M.singleton Nothing us' <> M.singleton (Just qualifier) natives
      Just (Right (FileUnits ps us')) -> Right . FileUnits ps <$> unionUnits (Just qualifier) natives us'
      Nothing -> pure . Right . FileUnits M.empty $ M.singleton (Just qualifier) natives
    pure $ M.insert fileName fUnits' resolved
  _ -> pure resolved

updateSingleItem :: (Monad m, Show a) => Text -> Text -> ItemImportF a -> EndoM (ExceptT Text m) (ImportMapF a)
updateSingleItem f p i m = do
  fileUnits' <- maybe (throwE $ "Could not find file " <> f) pure $ M.lookup f m
  pathUnits <- maybe (throwE $ "Could not find file " <> p) pure $ M.lookup p m
  let resolveUnits u = case fileUnits' of
        Left (UFU _ ps _) -> Right (FileUnits ps u)
        Right (FileUnits ps _) -> Right (FileUnits ps u)
      fileUnits = case fileUnits' of
        Left (UFU _ _ u) -> M.singleton Nothing u
        Right (FileUnits _ u) -> u
      natives = case pathUnits of
        Left (UFU _ _ u) -> u
        Right (FileUnits _ u) -> fromMaybe M.empty $ M.lookup Nothing u
  (n, i') <- case i of
    Named n _ ->
      let nStr = textToLabel n
       in fmap (nStr,) . maybe (throwE $ "Could not find item " <> n <> " in file " <> p) pure $ M.lookup nStr natives
    Aliased n a _ -> fmap (textToLabel a,) . maybe (throwE $ "Could not find item " <> n <> " in file " <> p) pure $ M.lookup (textToLabel n) natives
  flip (M.insert f) m . resolveUnits <$> unionUnits (Just "") (M.singleton n i') fileUnits

unionUnits :: (Monad m, Show a, Show b, Ord a, Ord k) => k -> Map a b -> EndoM (ExceptT Text m) (Map k (Map a b))
unionUnits k v' m = do
  let v = fromMaybe M.empty $ M.lookup k m
      n = M.intersection v v'
  if null n then pure $ M.insert k (v <> v') m else throwE . T.pack $ "Duplicate values: " ++ show n

lit :: Default a => Text -> ExpressionF a
lit = lit' def

lit' :: a -> Text -> ExpressionF a
lit' a = StringLiteral a . T.unpack

tShowExpr :: Show a => ExpressionF a -> Text
tShowExpr (StringLiteral _ str) = T.pack str
tShowExpr (AccountLiteral _ acct) = "<" <> T.pack (show acct) <> ">"
tShowExpr expr = T.pack $ show expr
