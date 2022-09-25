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

import Control.Lens
import Control.DeepSeq
import Data.Aeson as A
import Data.Map (Map)
--import Data.Text as T
import qualified Data.Map as M
import Data.Source
import Data.Traversable (for)

import GHC.Generics

--import qualified Generic.Random                     as GR
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

-- instance Arbitrary a => Arbitrary (CodeCollectionF a) where
--   arbitrary = GR.genericArbitrary GR.uniform

--instance Arbitrary CodeCollection  where

--instance Arbitrary a => Arbitrary (CodeCollectionF a) where
instance Arbitrary CodeCollection where
  arbitrary = do 

  -- sized arbHeapP
  --  where
  --   arbHeapP s =
  --     frequency
  --     [ (1, do return Empty)
  --     , (1, do x <- ) 
    contr <- arbitrary
    -- ary <- arbitrary SourceAnnotation
    oneof [return $ CodeCollection {
        _contracts  = M.fromList [("qq", contr)]-- = M.fromList [("qq", Contract {     
    --   _contractName = "SolidString",
    --   _parents = [],
    --   _constants = M.empty ,
    --   _storageDefs = M.empty ,
    --   _userDefined = M.empty ,
    --   _enums       = M.empty ,
    --   _structs     = M.empty ,
    --   _errors      = M.empty ,
    --   _events      = M.empty,
    --   _functions   = M.empty ,
    --   _constructor = Nothing ,
    --   _modifiers   = M.empty ,
    --   _vmVersion   = "",
    --   _contractContext = emptyAnnotation
    --     })]
    , _flFuncs     = M.empty
    , _flConstants = M.empty
    , _flEnums     = M.empty
    , _flStructs   = M.empty
    , _flErrors    = M.empty
    , _pragmas     = [("solidvm","3.3")]}]

-- instance Arbitrary (ExpressionF (SourceAnnotation T.Text)) where -- I think I can turn this signature into an a
--    arbitrary =  --Note I rather just us an Expression, not an ExpressionF(SourceAnnotation T.Text)
--       [return $ (NumberLiteral (emptyAnnotation) 2 Nothing), return $ (NumberLiteral (emptyAnnotation) 3 Nothing)]



-- emptyAnnotation :: SourceAnnotation T.Text
-- emptyAnnotation = (SourceAnnotation (initialPosition "") (initialPosition "") "")


-- dummyAnnotation :: SourceAnnotation ()
-- dummyAnnotation =
--   SourceAnnotation
--   {
--     _sourceAnnotationStart=SourcePosition {
--       _sourcePositionName="",
--       _sourcePositionLine=0,
--       _sourcePositionColumn=0
--       },
--     _sourceAnnotationEnd=SourcePosition {
--       _sourcePositionName="",
--         _sourcePositionLine=0,
--         _sourcePositionColumn=0
--       },
--     _sourceAnnotationAnnotation = ()
--   }