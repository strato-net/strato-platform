{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances    #-}

module SolidVM.Model.CodeCollection (
  CodeCollectionF(..),
  CodeCollection,
  flFuncs,
  contracts,
  getParents,
  flConstants,
  flStructs,
  flEnums,
  flErrors,
  pragmas,  
  module SolidVM.Model.CodeCollection.Contract,
  --module SolidVM.Model.CodeCollection.Def,
  module SolidVM.Model.CodeCollection.Function,
  module SolidVM.Model.CodeCollection.Statement,
  module SolidVM.Model.CodeCollection.ConstantDecl,
  --module SolidVM.Model.CodeCollection.Type,
  module SolidVM.Model.CodeCollection.VariableDecl,
  module SolidVM.Model.CodeCollection.Event,
  module SolidVM.Model.CodeCollection.VarDef
  ) where

import           Control.Lens
import           Control.DeepSeq
import           Data.Aeson as A
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Source
import           Data.Traversable (for)
import           GHC.Generics

import           Test.QuickCheck.Instances    ()
import           Test.QuickCheck

import           Blockchain.SolidVM.Exception

import           SolidVM.Model.CodeCollection.ConstantDecl
import           SolidVM.Model.CodeCollection.Contract
--import qualified SolidVM.Model.CodeCollection.Def as Def
import           SolidVM.Model.CodeCollection.Event
import           SolidVM.Model.CodeCollection.Function
import           SolidVM.Model.CodeCollection.Statement
--import           SolidVM.Model.CodeCollection.Type
import           SolidVM.Model.CodeCollection.VarDef
import           SolidVM.Model.CodeCollection.VariableDecl
import           SolidVM.Model.SolidString


data CodeCollectionF a =
  CodeCollection {
    _contracts :: Map SolidString (ContractF a),
    _flFuncs :: Map SolidString (FuncF a),
    _flConstants ::  Map SolidString (ConstantDeclF a),
    _flEnums :: Map SolidString ([SolidString], a),
    _flStructs :: Map SolidString [(SolidString, FieldType, a)],
    _flErrors :: Map SolidString [(SolidString, IndexedType, a)],
    _pragmas :: [(String, String)]
  } deriving (Show, Generic, NFData, Functor)

instance ToJSON a => ToJSON (CodeCollectionF a)
instance FromJSON a => FromJSON (CodeCollectionF a)

type CodeCollection = Positioned CodeCollectionF

makeLenses ''CodeCollectionF

type SolidEither = Either (Positioned ((,) SolidException))

getParents :: CodeCollection -> Contract -> SolidEither [Contract]
getParents cc c =
  let toErr x p = maybe (Left ( InternalError "contract parent does not exist" (labelToString p)
                              , x
                              ))
                        Right
  in for (c ^. parents) $ \p ->
       toErr (c ^. contractContext) p . M.lookup p $ cc ^. contracts


instance Arbitrary CodeCollection where
  arbitrary = do 


    contr <- arbitrary
    -- ary <- arbitrary SourceAnnotation
    oneof [return $ CodeCollection {
    _contracts  = M.fromList [("qq", contr)]
    , _flFuncs     = M.empty
    , _flConstants = M.empty
    , _flEnums     = M.empty
    , _flStructs   = M.empty
    , _flErrors    = M.empty
    , _pragmas     = [("solidvm","3.4")]}]
