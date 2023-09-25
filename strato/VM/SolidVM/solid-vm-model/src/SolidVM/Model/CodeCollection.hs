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
  flConstants,
  flStructs,
  flEnums,
  flErrors,
  pragmas,  
  imports,
  usesStrictModifiers,
  getContractsBySolidString,
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
import Control.DeepSeq
import Control.Lens
import Data.Aeson as A
import Data.Default
import Data.List (find)
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe (isJust)
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
  deriving (Show, Generic, NFData, Functor)

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
usesStrictModifiers = isJust . find ((== "strict") . fst) . _pragmas

-- Function to get all ContractF values matching a SolidString
getContractsBySolidString :: SolidString -> CodeCollectionF a -> [ContractF a]
getContractsBySolidString solidStr codeCollection =
  case M.lookup solidStr (_contracts codeCollection) of
    Just contract -> [contract] 
    Nothing       -> []         