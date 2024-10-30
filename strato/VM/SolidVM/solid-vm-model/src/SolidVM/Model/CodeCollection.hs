{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

module SolidVM.Model.CodeCollection (
  CodeCollectionF(..),
  CodeCollection,
  emptyCodeCollection,
  flFuncs,
  contracts,
  getParents,
  getTopLevelAbstracts,
  getTopLevelAbstractsForContract,
  flConstants,
  flStructs,
  flEnums,
  flErrors,
  pragmas,  
  imports,
  usesStrictModifiers,
  getContractsBySolidString,
  Pragma,
  supportedPragmaMap,
  supportedPragmas,
  resolvePragmaFeature,
  resolvePragmaFeature',
  resolveSolidVMVersion,
  resolveAllPragmas,
  isValidPragma,
  findInvalidPragmas,
  invalidPragmasUsedBy,
  invalidPragmasUsed,
  structDef,
  module SolidVM.Model.CodeCollection.Contract,
  --module SolidVM.Model.CodeCollection.Def,
  module SolidVM.Model.CodeCollection.Function,
  module SolidVM.Model.CodeCollection.Import,
  module SolidVM.Model.CodeCollection.Statement,
  module SolidVM.Model.CodeCollection.ConstantDecl,
  --module SolidVM.Model.CodeCollection.Type,
  module SolidVM.Model.CodeCollection.VariableDecl,
  module SolidVM.Model.CodeCollection.Event,
  module SolidVM.Model.CodeCollection.VarDef
  ) where

import Blockchain.SolidVM.Exception
import Control.Applicative ((<|>))
import Control.DeepSeq
import Control.Lens
import Data.Aeson as A
import Data.Binary
import Data.Default
import Data.Map (Map)
import qualified Data.Map as M
import qualified Data.Set as S
import Data.Source
import Data.Traversable (for)
import GHC.Generics
import SolidVM.Model.CodeCollection.ConstantDecl
import SolidVM.Model.CodeCollection.Contract
--import qualified SolidVM.Model.CodeCollection.Def as Def
import SolidVM.Model.CodeCollection.Event
import SolidVM.Model.CodeCollection.Function
import SolidVM.Model.CodeCollection.Import
import SolidVM.Model.CodeCollection.Statement
--import           SolidVM.Model.CodeCollection.Type
import SolidVM.Model.CodeCollection.VarDef
import SolidVM.Model.CodeCollection.VariableDecl
import SolidVM.Model.SolidString
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import qualified Text.Colors as CL

data CodeCollectionF a = CodeCollection
  { _contracts :: Map SolidString (ContractF a),
    _flFuncs :: Map SolidString (FuncF a),
    _flConstants :: Map SolidString (ConstantDeclF a),
    _flEnums :: Map SolidString ([SolidString], a),
    _flStructs :: Map SolidString [(SolidString, FieldType, a)],
    _flErrors :: Map SolidString [(SolidString, IndexedType, a)],
    _pragmas :: [(String, String)],
    _imports :: [FileImportF a]
  }
  deriving (Eq, Generic, NFData, Functor)

instance (Show a) => Show (CodeCollectionF a) where
  show (CodeCollection {..}) = 
    (CL.underline "\nCodeCollectionF") 
    ++ CL.yellow "\nCodeCollection._contracts\t" ++ concat (map (\(a,b) -> (CL.bright $ "\nCONTRACT " ++ show a) ++ "\n" ++ show b ++ "\n") (M.toList _contracts))
    ++ CL.yellow "\nCodeCollection._flFuncs\t" ++ show _flFuncs 
    ++ CL.yellow "\nCodeCollection._flConstants\t" ++ show _flConstants 
    ++ CL.yellow "\nCodeCollection._flEnums\t" ++ show _flEnums 
    ++ CL.yellow "\nCodeCollection._flStructs\t" ++ show _flStructs 
    ++ CL.yellow "\nCodeCollection._flErrors\t" ++ show _flErrors 
    ++ CL.yellow "\nCodeCollection._pragmas\t" ++ show _pragmas
    ++ CL.yellow "\nCodeCollection._imports\t" ++ show _imports

instance Binary a => Binary (CodeCollectionF a)

instance ToJSON a => ToJSON (CodeCollectionF a)

instance FromJSON a => FromJSON (CodeCollectionF a)

type CodeCollection = Positioned CodeCollectionF

makeLenses ''CodeCollectionF

emptyCodeCollection :: CodeCollectionF a
emptyCodeCollection = CodeCollection M.empty M.empty M.empty M.empty M.empty M.empty [] []

instance Default (CodeCollectionF a) where
  def = emptyCodeCollection

mergeCodeCollections :: CodeCollectionF a -> CodeCollectionF a -> CodeCollectionF a
mergeCodeCollections cc1 cc2 =
  CodeCollection
    { _contracts = cc1 ^. contracts <> cc2 ^. contracts,
      _flFuncs = cc1 ^. flFuncs <> cc2 ^. flFuncs,
      _flConstants = cc1 ^. flConstants <> cc2 ^. flConstants,
      _flEnums = cc1 ^. flEnums <> cc2 ^. flEnums,
      _flStructs = cc1 ^. flStructs <> cc2 ^. flStructs,
      _flErrors = cc1 ^. flErrors <> cc2 ^. flErrors,
      _pragmas = cc1 ^. pragmas <> cc2 ^. pragmas,
      _imports = cc1 ^. imports <> cc2 ^. imports
    }

instance Semigroup (CodeCollectionF a) where
  (<>) = mergeCodeCollections

instance Monoid (CodeCollectionF a) where
  mempty = def
  mappend = (<>)

type SolidEither = Either (Positioned ((,) SolidException))

getParents :: CodeCollection -> Contract -> SolidEither [Contract]
getParents cc c =
  let toErr x p =
        maybe
          ( Left
              ( InternalError "contract parent does not exist" (labelToString p),
                x
              )
          )
          Right
   in fmap concat . for (c ^. parents) $ \p -> do
        p' <- toErr (c ^. contractContext) p . M.lookup p $ cc ^. contracts
        (p' :) <$> getParents cc p'

getTopLevelAbstracts :: CodeCollection -> Map SolidString Contract
getTopLevelAbstracts cc = M.unions . map (getTopLevelAbstractsForContract cc) . M.elems $ _contracts cc

getTopLevelAbstractsForContract :: CodeCollection -> Contract -> Map SolidString Contract
getTopLevelAbstractsForContract cc = go
  where
    go c =
      let m = doParents c
       in if _contractType c == AbstractType && M.null m
            then M.singleton (_contractName c) c
            else m
    doParents = M.unions . map (maybe M.empty go . flip M.lookup (_contracts cc)) . _parents

instance Arbitrary CodeCollection where
  arbitrary = do
    contr <- arbitrary
    oneof
      [ return $
          CodeCollection
            { _contracts = M.fromList [("qq", contr)],
              _flFuncs = M.empty,
              _flConstants = M.empty,
              _flEnums = M.empty,
              _flStructs = M.empty,
              _flErrors = M.empty,
              _pragmas = [],
              _imports = []
            }
      ]

usesStrictModifiers :: CodeCollectionF a -> Bool
usesStrictModifiers = flip resolvePragmaFeature "strict" . _pragmas

-- Function to get all ContractF values matching a SolidString
getContractsBySolidString :: SolidString -> CodeCollectionF a -> Maybe (ContractF a)
getContractsBySolidString solidStr codeCollection = M.lookup solidStr (_contracts codeCollection)

type Pragma = (String, String)

supportedPragmaMap :: Map Pragma (S.Set Pragma)
supportedPragmaMap = M.fromList
  [ (("solidvm", "11.4"), S.fromList [
      ("es6", ""),
      ("strict", ""),
      ("builtinCreates", ""),
      ("safeExternalCalls", ""),
      ("strictDecimals", "")
     ])
  , (("solidvm", "11.5"), S.fromList [
      ("solidvm", "11.4")
    ])
  , (("solidvm", "12.0"), S.fromList [
      ("solidvm", "11.5")
    ])
  ]

supportedPragmas :: [Pragma]
supportedPragmas = S.toList . resolveAllPragmas $ M.keys supportedPragmaMap

resolvePragmaFeature :: [Pragma] -> String -> Bool
resolvePragmaFeature pragmaList feature = resolvePragmaFeature' pragmaList feature ""

resolvePragmaFeature' :: [Pragma] -> String -> String -> Bool
resolvePragmaFeature' pragmaList feature version = (feature, version) `S.member` resolveAllPragmas pragmaList

resolveSolidVMVersion :: String -> [Pragma]
resolveSolidVMVersion version = S.toList $ resolveAllPragmas [("solidvm", version)]

resolveAllPragmas :: [Pragma] -> S.Set Pragma
resolveAllPragmas ps = S.fromList $ concatMap go ps
  where go p = case M.lookup p supportedPragmaMap of
                 Nothing -> [p]
                 Just deps -> p : concatMap go deps

isValidPragma :: Pragma -> Bool
isValidPragma pragma = fst pragma == "solidity" || pragma `elem` supportedPragmas

findInvalidPragmas :: (a -> Pragma) -> a -> [a] -> [a]
findInvalidPragmas f pragma =
  if isValidPragma $ f pragma
    then id
    else (pragma :) -- include solidity pragma for backwards compatibility

invalidPragmasUsedBy :: (a -> Pragma) -> [a] -> [a]
invalidPragmasUsedBy f = foldr (findInvalidPragmas f) []

invalidPragmasUsed :: [Pragma] -> [Pragma]
invalidPragmasUsed = invalidPragmasUsedBy id

structDef :: ContractF a -> CodeCollectionF a -> SolidString -> Maybe [(SolidString, FieldType, a)]
structDef c cc n = (c ^. structs . at n) <|> (cc ^. flStructs . at n)