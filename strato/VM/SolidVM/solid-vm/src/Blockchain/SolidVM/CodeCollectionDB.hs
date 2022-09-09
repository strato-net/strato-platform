{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE RankNTypes #-}
module Blockchain.SolidVM.CodeCollectionDB
  ( ParseTypeCheckOrSolidVMError(..)
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
import           Control.Lens                         hiding (assign, from, to, bimap, Context)
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

import qualified SolidVM.Model.CodeCollection.Def as Def
import           SolidVM.CodeCollectionTools
import           SolidVM.Model.CodeCollection
import           SolidVM.Model.SolidString
import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Parse.ParserTypes
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker                            as TypeChecker
import qualified SolidVM.Solidity.StaticAnalysis.Functions.ConstantFunctions            as ConstantFunctions
import           SolidVM.Solidity.StaticAnalysis.Optimizer                              as O
import qualified        SolidVM.Solidity.StaticAnalysis.Statements.MultipleDeclarations as MultipleDeclarations

data ParseTypeCheckOrSolidVMError = PEx ParseError
                         | TCEx [SourceAnnotation T.Text]
                         | SVMEx (Positioned ((,) SolidException)) deriving (Show)

data SUnitIntermediary = Con Contract | FLC ConstantDecl | FLS Def.Def | FLE Def.Def | FLF Func | FLER Def.Def | Prag (String, String)

{-# NOINLINE unsafeCodeMapIORef #-}
unsafeCodeMapIORef :: IORef (Map Keccak256 CodeCollection)
unsafeCodeMapIORef = unsafePerformIO $ newIORef M.empty

withAnnotations :: (a -> Either ParseTypeCheckOrSolidVMError b) -> a -> Either [SourceAnnotation T.Text] b
withAnnotations f = first unwind . f
  where unwind (PEx pe) = [parseErrorToAnnotation pe]
        unwind (SVMEx (e,x)) = [T.pack (show e) <$ x]
        unwind (TCEx errs) = errs

parseSource :: T.Text -> T.Text -> Either ParseTypeCheckOrSolidVMError [SourceUnit]
parseSource fileName src = bimap PEx unsourceUnits $ runParser solidityFile (ParserState "" "" M.empty) (T.unpack fileName) (T.unpack src)

parseSourceWithAnnotations :: T.Text -> T.Text -> Either [SourceAnnotation T.Text] [SourceUnit]
parseSourceWithAnnotations = withAnnotations . parseSource

compileSourceNoInheritance :: Map T.Text T.Text -> Either ParseTypeCheckOrSolidVMError CodeCollection
compileSourceNoInheritance initCodeMap = do
  let getNamedSUnits :: T.Text -> T.Text -> Either ParseTypeCheckOrSolidVMError [(SolidString, SUnitIntermediary)]
      getNamedSUnits fileName src = do
        sourceUnits <- parseSource fileName src
<<<<<<< HEAD
<<<<<<< HEAD
        let pragmas' = \case
=======
        let userDefinedFromFile = M.fromList $ map (\(Alias _ alias typ) -> (alias, typ) ) $ filter (\x -> case x of (Alias _ _ _) -> True; _ -> False;) sourceUnits
        let pragmas = \case
>>>>>>> develop
=======

        let pragmas' = \case

>>>>>>> d44827bb4bca0e6760a524513594bb02696aaa21
              Pragma _ n v -> Just (n, v)
              _ -> Nothing
            vmVersion' = if (Just ("solidvm","3.3")) `elem` (pragmas' <$> sourceUnits) then "svm3.3" else (if (Just ("solidvm","3.2")) `elem` (pragmas' <$> sourceUnits) then "svm3.2" else (if (Just ("solidvm","3.0")) `elem` (pragmas' <$> sourceUnits) then "svm3.0" else ""))
        fmap catMaybes . for sourceUnits $ \case
          NamedXabi name (xabi, parents') -> do
            ctrct <- first SVMEx
                   $ xabiToContract (textToLabel name) (map textToLabel parents') vmVersion' userDefinedFromFile xabi
            pure $ Just $ (textToLabel name, Con ctrct)
          FLFunc name fdec -> do
            pure $ Just $ (name, FLF fdec)
          FLConstant name cnst -> do
            pure $ Just $ (textToLabel name, FLC cnst)
          FLStruct name fls -> do
            pure $ Just $ (textToLabel name, FLS fls)
          FLEnum name fle -> do
            pure $ Just $ (textToLabel name, FLE fle)
          FLError name args -> do
            pure $ Just $ (textToLabel name, FLER args)
          Pragma _ n v -> do 
            pure $ Just $ (" ", Prag (n,v))
          _ -> pure Nothing
<<<<<<< HEAD
<<<<<<< HEAD
=======

>>>>>>> d44827bb4bca0e6760a524513594bb02696aaa21
--      sUnitSorter :: [(SolidString, SUnitIntermediary)] ->  ([(SolidString, ConstantDecl)], [(SolidString, Contract)], [(SolidString, ([SolidString], a))], [(SolidString, [(SolidString, FieldType, a)])])
      sUnitSorter = foldr (\(name, sUnit) (cs, cs2, cs3, cs4, cs5, cs6, cs7) -> case sUnit of
        Con ctrct -> (cs, (name, ctrct):cs2, cs3, cs4, cs5, cs6, cs7)
        FLC cnst -> ((name, cnst):cs, cs2, cs3, cs4, cs5, cs6, cs7)
        FLE (Def.Enum vals _ a) -> (cs, cs2, (name, (vals, a)):cs3, cs4, cs5 ,cs6,cs7)
        FLS (Def.Struct vals _ a) -> (cs, cs2, cs3, (name, (\(k,v) -> (k,v,a)) <$> vals):cs4, cs5, cs6, cs7) --conversion to match struct form
        FLF f -> (cs, cs2, cs3, cs4, (name, f):cs5, cs6, cs7)
        FLER (Def.Error vals _ a) -> (cs, cs2, cs3, cs4, cs5, (name, (\(k,v) -> (k,v,a)) <$> vals):cs6, cs7)
        Prag (l,r) -> (cs, cs2, cs3, cs4, cs5, cs6, (l,r):cs7)
        FLE y -> parseError "FLE non Enum should be impossible"   (show y)
        FLS x -> parseError "FLS non Struct should be impossible" (show x)
        FLER x -> parseError "FLER non Error should be impossible" (show x)
        ) ([], [], [], [], [], [], [])
      throwDuplicate :: (SolidString, Contract) -> Map SolidString Contract -> Either ParseTypeCheckOrSolidVMError (Map SolidString Contract)
      throwDuplicate (cName, unit) m = case M.lookup cName m of
        Nothing -> pure $ M.insert cName unit m
<<<<<<< HEAD
=======

      throwDuplicate' :: (SolidString, a) -> Map SolidString a -> (a -> SourceAnnotation b) -> Either ParseTypeCheckOrSolidVMError (Map SolidString a)
      throwDuplicate' (sName, unit) m contextFunc = case M.lookup sName m of
        Nothing -> pure $ M.insert sName unit m
>>>>>>> develop
=======

>>>>>>> d44827bb4bca0e6760a524513594bb02696aaa21
        Just _ ->  Left . PEx
                  $ newErrorMessage (Message $ "Duplicate unit found: " ++ labelToString sName)
                                    (fromSourcePosition $ _sourceAnnotationStart $ contextFunc unit)

      throwDuplicate :: (SolidString, SUnitIntermediary) ->  CodeCollection -> Either ParseTypeCheckOrSolidVMError CodeCollection
      throwDuplicate (name, sUnit) cc = case sUnit of 
        Con ctrct                 -> fmap (\cMap -> cc & contracts   .~ cMap) $ throwDuplicate' (name, ctrct) (cc ^. contracts)  _contractContext
        FLC cnst                  -> fmap (\cMap -> cc & flConstants .~ cMap) $ throwDuplicate' (name, cnst) (cc ^. flConstants) _constContext
        FLE (Def.Enum vals _ a)   -> fmap (\cMap -> cc & flEnums     .~ cMap) $ throwDuplicate' (name, (vals, a)) (cc ^. flEnums) (const a)
        FLS (Def.Struct vals _ a) -> fmap (\cMap -> cc & flStructs   .~ cMap) $ throwDuplicate' (name, (\(k,v) -> (k,v,a)) <$> vals) (cc ^. flStructs) (\_ -> a)
        FLF func                  -> fmap (\cMap -> cc & flFuncs     .~ cMap) $ throwDuplicateFunction (name, func) (cc ^. flFuncs) -- Thanks Jin!
        FLER (Def.Error vals _ a) -> fmap (\cMap -> cc & flErrors    .~ cMap) $ throwDuplicate' (name, (\(k,v) -> (k,v,a)) <$> vals) (cc ^. flErrors) (\_ -> a) 
        FLE y  -> parseError  "FLE non Enum should be impossible  "  (show y)
        FLS x  -> parseError  "FLS non Struct should be impossible"  (show x)
        FLER z -> parseError  "FLER non Error should be impossible"  (show z)
      sUnitSorter = foldrM throwDuplicate $ CodeCollection M.empty M.empty M.empty M.empty M.empty M.empty -- the list of all the sUnits goes here

      throwDuplicateFunction :: (SolidString, Func) -> Map SolidString Func -> Either ParseTypeCheckOrSolidVMError (Map SolidString Func)
      throwDuplicateFunction (fname, func) m = case M.lookup fname m of
        Nothing -> pure $ M.insert fname func m 
        Just fdec -> do
          let oldParamTypes = fmap snd $ _funcArgs fdec
              newParamTypes = fmap snd $ _funcArgs func
              overloadParamTypes = concatMap (\x -> [fmap snd $ _funcArgs x]) $ _funcOverload fdec
          if ((oldParamTypes == newParamTypes) || (newParamTypes `elem` overloadParamTypes))
            then Left . PEx $ newErrorMessage (Message $ "Free function could not be overloaded: " ++ labelToString fname)
                                              (fromSourcePosition $ _sourceAnnotationStart $ _funcContext func)
            else do
              pure $ M.insert fname (fdec{_funcOverload = _funcOverload fdec ++ [func]}) m
                                           
  allSUnits <- fmap concat . traverse (uncurry getNamedSUnits) $ M.toList initCodeMap
<<<<<<< HEAD
<<<<<<< HEAD
=======

>>>>>>> d44827bb4bca0e6760a524513594bb02696aaa21
  let (allConstants, allContracts, allEnums, allStructs, allFreeFunctions, allCustomErrors, allPragmas) = sUnitSorter allSUnits
  deduplicatedContracts <- foldrM throwDuplicate M.empty allContracts
  deduplicatedFreeFunctions <- foldrM throwDuplicateFunction M.empty (allFreeFunctions :: [(SolidString, Func)])
  pure $ CodeCollection {
    _contracts = deduplicatedContracts,
    _flFuncs = deduplicatedFreeFunctions,
    _flConstants = M.fromList allConstants,
    _flEnums = M.fromList allEnums,
    _flStructs = M.fromList allStructs,
    _flErrors = M.fromList allCustomErrors,
    _pragmas =  allPragmas
    
  }
<<<<<<< HEAD
=======
  theCC <- sUnitSorter allSUnits
  pure $ theCC
>>>>>>> develop
=======

>>>>>>> d44827bb4bca0e6760a524513594bb02696aaa21

hasSvm3_2 :: CodeCollection -> Bool
hasSvm3_2 cc = any (=="svm3.2") vmVers
  where
    contractList = map snd $ M.toList (cc ^. contracts )
    vmVers = map (^. vmVersion ) contractList

hasSvm3_3 :: CodeCollection -> Bool
hasSvm3_3 cc = any (=="svm3.3") vmVers
  where
    contractList = map snd $ M.toList (cc ^. contracts )
    vmVers = map (^. vmVersion ) contractList
    
--- Don't typecheck in Slipstream!!!
compileSource :: Bool -> Map T.Text T.Text-> Either ParseTypeCheckOrSolidVMError CodeCollection
compileSource typeCheck mTT = do
  let applyInheritanceE = first SVMEx . applyInheritance
  O.detector <$> case (applyInheritanceE <=< compileSourceNoInheritance) mTT of
    Right cc | typeCheck && hasSvm3_2 cc -> typeCheckDetectorSvm3_2 cc
             | typeCheck && hasSvm3_3 cc -> typeCheckDetectorSvm3_3 cc
             | otherwise                 -> Right cc
    Left x -> Left x
    where
      typeCheckDetectorSvm3_2 ecc = case TypeChecker.detector ecc of
        [] -> Right ecc
        xs -> Left $ TCEx xs
      typeCheckDetectorSvm3_3 ecc = case TypeChecker.detector ecc <> ConstantFunctions.detector ecc <> MultipleDeclarations.detector ecc of
        [] -> Right ecc
        xs -> Left $ TCEx xs

compileSourceWithAnnotations :: Bool -> Map T.Text T.Text -> Either [SourceAnnotation T.Text] CodeCollection
compileSourceWithAnnotations typeCheck = withAnnotations (compileSource typeCheck)

codeCollectionFromSource :: (MonadIO m, HasCodeDB m) => Bool -> B.ByteString -> m (Keccak256, CodeCollection)
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
  codeMap <- liftIO $ readIORef unsafeCodeMapIORef
  case M.lookup hsh codeMap of
    Just cc -> do
      recordCacheEvent CacheHit
      return (hsh, cc)
    Nothing -> do
      recordCacheEvent StorageWrite
      hsh' <- addCode SolidVM canonicalInitCode
      let ecc = compileSource typeCheck initMap
          cc = case ecc of
                 Right a -> a
                 Left (PEx p) -> parseError "codeCollectionFromSource" p
                 Left (SVMEx (s, _)) -> throw s
                 Left (TCEx xs) -> typeError "Typechecker" (typeErrorToAnnotation xs)
      let codeMap' = M.insert hsh cc codeMap
      recordCacheSize $ M.size codeMap'
      liftIO $ writeIORef unsafeCodeMapIORef codeMap'
      return $ assert (hsh == hsh') (hsh, cc)

codeCollectionFromHash :: (MonadIO m, HasCodeDB m) => Bool -> Keccak256 -> m CodeCollection
codeCollectionFromHash typeCheck hsh = do
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
          let ecc = compileSource typeCheck initMap
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
