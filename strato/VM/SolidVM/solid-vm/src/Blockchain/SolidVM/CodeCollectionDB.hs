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
import           SolidVM.Solidity.StaticAnalysis.Typechecker as TC
--import           SolidVM.Model.CodeCollection.ConstantDecl

data ParseTypeCheckOrSolidVMError = PEx ParseError
                         | TCEx [SourceAnnotation T.Text]
                         | SVMEx (Positioned ((,) SolidException)) deriving (Show)

-- data SUnitIntermediary = Con Contract | FLC ConstantDecl | FLS Def.Def | FLE Def.Def | Lib Library | Intr Interface | FLF Func (Show, Eq)

{-# NOINLINE unsafeCodeMapIORef #-}
unsafeCodeMapIORef :: IORef (Map Keccak256 CodeCollection)
unsafeCodeMapIORef = unsafePerformIO $ newIORef M.empty

withAnnotations :: (a -> Either ParseTypeCheckOrSolidVMError b) -> a -> Either [SourceAnnotation T.Text] b
withAnnotations f = first unwind . f
  where unwind (PEx pe) = [parseErrorToAnnotation pe]
        unwind (SVMEx (e,x)) = [T.pack (show e) <$ x]
        unwind (TCEx errs) = errs

parseSource :: T.Text -> T.Text -> Either ParseTypeCheckOrSolidVMError [SourceUnit]
parseSource fileName src = bimap PEx unsourceUnits $ runParser solidityFile (ParserState "" "") (T.unpack fileName) (T.unpack src)

parseSourceWithAnnotations :: T.Text -> T.Text -> Either [SourceAnnotation T.Text] [SourceUnit]
parseSourceWithAnnotations = withAnnotations . parseSource

compileSourceNoInheritance :: Map T.Text T.Text -> Either ParseTypeCheckOrSolidVMError CodeCollection
compileSourceNoInheritance initCodeMap = do
  let getNamedSUnits :: T.Text -> T.Text -> Either ParseTypeCheckOrSolidVMError [(SolidString, SUnitIntermediary)]
      getNamedSUnits fileName src = do
        sourceUnits <- parseSource fileName src
        let pragmas = \case
              Pragma _ n v -> Just (n, v)
              _ -> Nothing
            vmVersion' = if (Just ("solidvm","3.3")) `elem` (pragmas <$> sourceUnits) then "svm3.3" else (if (Just ("solidvm","3.2")) `elem` (pragmas <$> sourceUnits) then "svm3.2" else (if (Just ("solidvm","3.0")) `elem` (pragmas <$> sourceUnits) then "svm3.0" else ""))
        fmap catMaybes . for sourceUnits $ \case
          NamedXabi name (xabi, parents') -> 
            pure $ Just $ (textToLabel name, xabiToSUnitIntermediary (textToLabel name) (map textToLabel parents') vmVersion' xabi)
          FLFunc name fdec -> do
            pure $ Just $ (name, FLF fdec)
          FLConstant name cnst -> do
            pure $ Just $ (textToLabel name, FLC cnst)
          FLStruct name fls -> do
            pure $ Just $ (textToLabel name, FLS fls)
          FLEnum name fle -> do
            pure $ Just $ (textToLabel name, FLE fle)
          _ -> pure Nothing
          
      throwDuplicate' :: (SolidString, a) -> Map SolidString a -> (a -> SourceAnnotation b) -> Either ParseTypeCheckOrSolidVMError (Map SolidString a)
      throwDuplicate' (sName, unit) m contextFunc = case M.lookup sName m of
        Nothing -> pure $ M.insert sName unit m
        Just _ ->  Left . PEx
                  $ newErrorMessage (Message $ "Duplicate unit found: " ++ labelToString sName)
                                    (fromSourcePosition $ _sourceAnnotationStart $ contextFunc unit)

      -- TODO for those who dare I am fairly certain this can be done with a curried LiftM7 function                              
      -- throwDuplicate :: (SolidString, SUnitIntermediary) -> ((Map SolidString Contract), (Map SolidString ConstantDecl), (Map SolidString ([SolidString], a)), (Map SolidString [(SolidString, FieldType, a)]), (Map SolidString Library), (Map SolidString Interface))-> Either ParseTypeCheckOrSolidVMError ((Map SolidString Contract), (Map SolidString ConstantDecl), (Map SolidString ([SolidString], a)), (Map SolidString [(SolidString, FieldType, a)]), (Map SolidString Library), (Map SolidString Interface))
      throwDuplicate :: (SolidString, SUnitIntermediary) ->  CodeCollection -> Either ParseTypeCheckOrSolidVMError CodeCollection
      throwDuplicate (name, sUnit) cc = case sUnit of 
        Con ctrct                 -> fmap (\cMap -> cc & contracts   .~ cMap) $ throwDuplicate' (name, ctrct) (cc ^. contracts)  _contractContext
        FLC cnst                  -> fmap (\cMap -> cc & flConstants .~ cMap) $ throwDuplicate' (name, cnst) (cc ^. flConstants) constContext
        FLE (Def.Enum vals _ a)   -> fmap (\cMap -> cc & flEnums     .~ cMap) $ throwDuplicate' (name, (vals, a)) (cc ^. flEnums) (const a)
        FLS (Def.Struct vals _ a) -> fmap (\cMap -> cc & flStructs   .~ cMap) $ throwDuplicate' (name, (\(k,v) -> (k,v,a)) <$> vals) (cc ^. flStructs) (\_ -> a)
        Lib lib                   -> fmap (\cMap -> cc & librarys    .~ cMap) $ throwDuplicate' (name, lib) (cc ^. librarys) _libraryContext
        Intr intr                 -> fmap (\cMap -> cc & interfaces  .~ cMap) $ throwDuplicate' (name, intr) (cc ^. interfaces) _interfaceContext
        FLF func                  -> fmap (\cMap -> cc & flFuncs     .~ cMap) $ throwDuplicateFunction (name, func) (cc ^. flFuncs) -- Thanks Jin! 
        FLE y -> parseError "FLE non Enum should be impossible"   (show y)
        FLS x -> parseError "FLS non Struct should be impossible" (show x)
      sUnitSorter = foldrM throwDuplicate $ CodeCollection M.empty M.empty M.empty M.empty M.empty M.empty M.empty -- the list of all the sUnits goes here

      

      throwDuplicateFunction :: (SolidString, Func) -> Map SolidString Func -> Either ParseTypeCheckOrSolidVMError (Map SolidString Func)
      throwDuplicateFunction (fname, func) m = case M.lookup fname m of
        Nothing -> pure $ M.insert fname func m 
        Just fdec -> do
          let oldParamTypes = fmap snd $ funcArgs fdec
              newParamTypes = fmap snd $ funcArgs func
              overloadParamTypes = concatMap (\x -> [fmap snd $ funcArgs x]) $ funcOverload fdec
          if ((oldParamTypes == newParamTypes) || (newParamTypes `elem` overloadParamTypes))
            then Left . PEx $ newErrorMessage (Message $ "Free function could not be overloaded: " ++ labelToString fname)
                                              (fromSourcePosition $ _sourceAnnotationStart $ funcContext func)
            else do
              pure $ M.insert fname (fdec{funcOverload = funcOverload fdec ++ [func]}) m
                                           
  allSUnits <- fmap concat . traverse (uncurry getNamedSUnits) $ M.toList initCodeMap
  theCC <- sUnitSorter allSUnits
  pure $ theCC

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
  case (applyInheritanceE <=< compileSourceNoInheritance) mTT of
    Right cc -> do if typeCheck && (hasSvm3_2 cc || hasSvm3_3 cc) then typeCheckDetector cc else Right cc
    Left x -> Left x
    where
      typeCheckDetector ecc = case TC.detector ecc of
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
