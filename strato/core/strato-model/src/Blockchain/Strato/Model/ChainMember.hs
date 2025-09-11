{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE NoDeriveAnyClass #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Strato.Model.ChainMember
  ( emptyChainMember,
    ChainMemberRSet (..),
    ChainMemberParsedSet (..),
    chainMemberParsedSetToValidator,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Validator (Validator(..))
import Control.DeepSeq
--import Control.Lens hiding ((.=))
import Data.Aeson hiding (Array, String)
import qualified Data.Aeson as A (Value (..))
--import Data.Aeson.Casing.Internal (camelCase, dropFPrefix)
import Data.Binary
import Data.Data
import qualified Data.Functor.Identity as DFI
--import Data.Maybe (fromMaybe)
import Data.Ranged
import qualified Data.Set as S
import Data.Swagger hiding (Format, get, name, put, url)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Vector as V
import qualified Database.Persist.Sql as DPS
import GHC.Generics
import qualified Generic.Random as GR
import qualified LabeledError
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Arbitrary.Generic
import Test.QuickCheck.Instances.Text ()
import Text.Format

data BoundedData a = LowerBound | Middle a | UpperBound deriving (Eq, Generic, Show)

data ChainMemberF f = ChainMemberF
  { commonName :: f (Maybe T.Text)
  }
  deriving (Generic)

newtype ChainMemberRSet = ChainMemberRSet {getChainMemberRSet :: (RSet ChainMemberBounded)} deriving (Eq, Show)

newtype ChainMembers = ChainMembers {unChainMembers :: S.Set ChainMemberParsedSet} deriving (Generic, Eq, Data, Show, Ord)

newtype TrueOrgNameChains = TrueOrgNameChains (S.Set Word256) deriving (Eq)

newtype FalseOrgNameChains = FalseOrgNameChains (S.Set Word256) deriving (Eq)

data ChainMemberParsedSet = CommonName Text deriving (Generic, Eq, Data, Show, Ord, Read)
{-
instance ToSchema ChainMemberParsedSet where
  declareNamedSchema proxy =
    genericDeclareNamedSchema cmpsSchemaOptions proxy
      & mapped . schema . description ?~ "ChainMemberParsedSet"
      & mapped . schema . example ?~ toJSON exCMPSRespone

exCMPSRespone :: ChainMemberParsedSet
exCMPSRespone = CommonName "BlockApps" "Engineering" "Admin"

-- | The model's field modifiers will match the JSON instances
cmpsSchemaOptions :: SchemaOptions
cmpsSchemaOptions =
  SchemaOptions
    { fieldLabelModifier = camelCase . dropFPrefix,
      constructorTagModifier = id,
      datatypeNameModifier = id,
      allNullaryToStringTag = True,
      unwrapUnaryRecords = True
    }
-}
type ChainMemberBounded = ChainMemberF BoundedData

newtype ChainMemberRange = ChainMemberRange {unChainMemberRange :: Range ChainMemberBounded} deriving (Show)

instance Ord a => Ord (BoundedData a) where
  LowerBound `compare` LowerBound = EQ
  LowerBound `compare` _ = LT
  UpperBound `compare` UpperBound = EQ
  UpperBound `compare` _ = GT
  (Middle a) `compare` (Middle b) = a `compare` b
  (Middle _) `compare` LowerBound = GT
  (Middle _) `compare` UpperBound = LT

instance Ord (ChainMemberF BoundedData) where
  compare (ChainMemberF cm1) (ChainMemberF cm2) = compare cm1 cm2

instance (DiscreteOrdered (ChainMemberF BoundedData)) where
  adjacent _ _ = False
  adjacentBelow = const Nothing

instance (DiscreteOrdered (Range ChainMemberBounded)) where
  adjacent _ _ = False
  adjacentBelow = const Nothing

instance NFData ChainMemberParsedSet where
  -- rnf (ChainMember (ChainMemberF (DFI.Identity on) (DFI.Identity ou) (DFI.Identity cn))) = on `seq` ou `seq` cn `seq` ()
  rnf (CommonName c) = c `seq` ()
  
instance Eq (ChainMemberF BoundedData) where
  (==) (ChainMemberF cm1) (ChainMemberF cm2) = (cm1 == cm2)

instance Format ChainMemberParsedSet where
  format = show

instance Show (ChainMemberF BoundedData) where
  show (ChainMemberF cm) = show cm

deriving instance Show (ChainMemberF DFI.Identity)

emptyChainMember :: ChainMemberParsedSet
emptyChainMember = CommonName "" --(Everyone a) (Org a b) (OrgUnit a b c) (CommonName a b c d)

instance Binary ChainMembers

instance Binary ChainMemberParsedSet

instance RLPSerializable ChainMembers where
  rlpEncode (ChainMembers cms) = rlpEncode $ S.toList cms
  rlpDecode x = ChainMembers . S.fromList $ rlpDecode x

instance RLPSerializable (BoundedData Text) where
  rlpEncode (LowerBound) = RLPScalar 0
  rlpEncode (Middle a) = RLPArray [RLPScalar 1, rlpEncode a]
  rlpEncode (UpperBound) = RLPScalar 2
  rlpDecode (RLPScalar 0) = LowerBound
  rlpDecode (RLPArray [RLPScalar 1, a]) = Middle $ rlpDecode a
  rlpDecode (RLPScalar 2) = UpperBound
  rlpDecode _ = error ("Error in rlpDecode for BoundedData: bad RLPObject")

instance RLPSerializable (BoundedData (Maybe Text)) where
  rlpEncode (LowerBound) = RLPScalar 0
  rlpEncode (Middle (Just a)) = RLPArray [RLPScalar 1, rlpEncode a]
  rlpEncode (Middle Nothing) = RLPArray [RLPScalar 1]
  rlpEncode (UpperBound) = RLPScalar 2
  rlpDecode (RLPScalar 0) = LowerBound
  rlpDecode (RLPArray [RLPScalar 1, a]) = Middle $ Just $ rlpDecode a
  rlpDecode (RLPArray [RLPScalar 1]) = Middle Nothing
  rlpDecode (RLPScalar 2) = UpperBound
  rlpDecode _ = error ("Error in rlpDecode for BoundedData: bad RLPObject")

instance RLPSerializable (BoundedData ()) where
  rlpEncode (LowerBound) = RLPScalar 0
  rlpEncode (Middle _) = RLPScalar 1
  rlpEncode (UpperBound) = RLPScalar 2
  rlpDecode (RLPScalar 0) = LowerBound
  rlpDecode (RLPScalar 1) = Middle ()
  rlpDecode (RLPScalar 2) = UpperBound
  rlpDecode _ = error ("Error in rlpDecode for BoundedData (): bad RLPObject")

instance RLPSerializable ChainMemberBounded where
  rlpEncode (ChainMemberF cmn) =
    RLPArray
      [ rlpEncode cmn
      ]
  rlpDecode (RLPArray [cmn]) =
    ChainMemberF
      (rlpDecode cmn)
  rlpDecode o = error $ "rlpDecode ChainMember: Expected 4 element RLPArray, got " ++ show o

instance RLPSerializable ChainMemberRSet where
  rlpDecode = do
    chainMemberRange <- rlpDecode
    pure . ChainMemberRSet . makeRangedSet $ unChainMemberRange <$> chainMemberRange
  rlpEncode (ChainMemberRSet rset) = do
    rlpEncode $ ChainMemberRange <$> rSetRanges rset

instance RLPSerializable ChainMemberRange where
  rlpDecode (RLPArray [lb, ub]) =
    (ChainMemberRange (Range (getBoundary lb) (getBoundary ub)))
    where
      getBoundary (RLPArray [RLPScalar t, s]) = case (t, s) of
        (0, f) -> BoundaryAbove $ rlpDecode f
        (2, f) -> BoundaryBelow $ rlpDecode f
        _ -> error $ "invalid shape for ChainMemberRange: "
      getBoundary (RLPArray [RLPScalar t]) = case (t) of
        (1) -> BoundaryAboveAll
        (3) -> BoundaryBelowAll
        _ -> error $ "invalid shape for ChainMemberRange: "
      getBoundary _ = error $ "invalid shape for ChainMemberRange: "
  rlpDecode x = error $ "invalid shape for ChainMemberRange: " ++ show x
  rlpEncode (ChainMemberRange (Range x y)) = RLPArray [putBoundary x, putBoundary y]
    where
      putBoundary (BoundaryAbove z) = RLPArray [RLPScalar 0, rlpEncode z]
      putBoundary BoundaryAboveAll = RLPArray [RLPScalar 1]
      putBoundary (BoundaryBelow z) = RLPArray [RLPScalar 2, rlpEncode z]
      putBoundary BoundaryBelowAll = RLPArray [RLPScalar 3]

instance RLPSerializable ChainMemberParsedSet where
  rlpEncode (CommonName c) = RLPArray [rlpEncode c]
  rlpDecode (RLPArray [c]) = CommonName (rlpDecode c)
  rlpDecode v = error $ "Error in rlpDecode for ChainMemberParsedSet: bad RLPObject: " ++ show v
  
instance Arbitrary ChainMembers where
  arbitrary = genericArbitrary

instance Arbitrary ChainMemberParsedSet where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema ChainMembers where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "ChainMembers") mempty
      
instance FromJSON ChainMembers where
  parseJSON (A.Array xs) = ChainMembers . S.fromList <$> traverse parseJSON (V.toList xs)
  parseJSON x = fail $ "couldn't parse JSON for chain members info: " ++ show x

instance ToJSON ChainMembers where
  toJSON (ChainMembers xs) = toJSON (S.toList xs)
  
instance FromJSON ChainMemberParsedSet where
  parseJSON (A.String s) = pure $ CommonName s
  parseJSON (Object o) = do
    c <- o .:? "commonName"
    case c of
      Nothing -> error "no commonName"
      Just name -> pure $ CommonName name
  parseJSON o = fail $ "parseJSON ChainMembersParsedSet failed: expected object, got: " ++ show o

instance ToJSON ChainMemberParsedSet where
  toJSON (CommonName c) = object ["commonName" .= c]

instance DPS.PersistField ChainMemberParsedSet where
  toPersistValue = DPS.PersistText . T.pack . show
  fromPersistValue (DPS.PersistText t) =
    let !cmps = Right . LabeledError.read "PersistField/ChainMemberParsedSet" . T.unpack $ t
     in cmps
  fromPersistValue x = Left . T.pack $ "PersistField ChainMemberParsedSet: expected string: " ++ show x

instance DPS.PersistFieldSql ChainMemberParsedSet where
  sqlType _ = DPS.SqlString

chainMemberParsedSetToValidator :: ChainMemberParsedSet -> Validator
chainMemberParsedSetToValidator (CommonName c) = Validator c
