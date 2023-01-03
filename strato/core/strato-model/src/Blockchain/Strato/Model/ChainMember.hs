{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoDeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE DeriveAnyClass     #-}


module Blockchain.Strato.Model.ChainMember (
  getTextFromIdentity,
  getTextFromIdentity',
  cmBoundedToRSet,
  emptyChainMember,
  removeChainMember,
  getRangeFromBounds,
  chainMembersToChainMemberRset,
  chainMemberParsedSetToChainMemberRSet,
  isChainMemberInRangeSet,
  getBoundsFromCMBounded,
  rowToSet,
  encodeChainMemberRSet,
  decodeChainMemberRSet,
  chainMemberParsedSetToString,  -- chainMemberToChainMemberParsedSet,
  getTrueChainMemberParsedSets,
  getFalseChainMemberParsedSets,
  ChainMembers(..),
  ChainMemberRSet(..),
  ChainMemberBounded,
  ChainMemberF(..),
  ChainMemberParsedSet(..),
  TrueOrgNameChains(..),
  FalseOrgNameChains(..),
  ) where

import           Control.DeepSeq
import           Control.Lens                         hiding ((.=))
import qualified Database.Persist.Sql                 as DPS
import           Data.Aeson                           hiding (Array, String)
import qualified Data.Aeson                           as A (Value(..))
import           Data.Binary                          
import           Data.Function                        (on)
import           Data.Ranged
import           Data.Aeson.Casing.Internal           (camelCase, dropFPrefix)
import           Data.Swagger                         hiding (get, name, put, url, Format)
import qualified Data.ByteString.Lazy.Internal        as BSLI
import           Data.Data
import qualified Data.Default                         as D
import           Data.List                            (foldl')
import           Data.Maybe                           (fromMaybe)
import qualified Data.Set                             as S
import           Data.Text                            (Text)
import qualified Data.Vector                          as V
import           GHC.Generics
import           Blockchain.Data.RLP
import qualified Data.Text                            as T
import           Test.QuickCheck.Instances.Text       ()
import           Text.Format                          
import           Text.Printf
import qualified Data.Functor.Identity                               as DFI
import           Generics.Deriving 
import           Test.QuickCheck.Arbitrary
import           Test.QuickCheck.Arbitrary.Generic
import qualified Generic.Random                     as GR
import qualified LabeledError
import           Blockchain.Strato.Model.ExtendedWord

-- import           Test.QuickCheck

data BoundedData a =  LowerBound | Middle a | UpperBound deriving (Eq, Generic, Show)


data ChainMemberF f = ChainMemberF
  { orgName    :: f T.Text
  , orgUnit    :: f (Maybe T.Text)
  , commonName :: f (Maybe T.Text)
  } deriving (Generic)


newtype ChainMemberRSet = ChainMemberRSet {getChainMemberRSet :: (RSet ChainMemberBounded)} deriving (Eq, Show)


newtype ChainMembers = ChainMembers { unChainMembers :: S.Set ChainMemberParsedSet } deriving(Generic, Eq, Data, Show, Ord)

instance NFData ChainMembers

instance ToJSONKey ChainMembers

instance FromJSONKey ChainMembers

instance Semigroup ChainMembers where
  (ChainMembers cm) <> _ = ChainMembers cm

instance Monoid ChainMembers where
  mempty = ChainMembers (S.empty)
  mappend = (<>)

instance Format ChainMembers where
  format = show

newtype TrueOrgNameChains = TrueOrgNameChains { unTrueOrgNameChains :: S.Set Word256 } deriving (Eq)

newtype FalseOrgNameChains = FalseOrgNameChains { unFalseOrgNameChains :: S.Set Word256 } deriving (Eq)

data ChainMemberParsedSet =
  Everyone Bool
  | Org Text Bool
  | OrgUnit Text Text Bool
  | CommonName Text Text Text Bool deriving(Generic, Eq, Data, Show, Ord, Read)

instance ToJSONKey ChainMemberParsedSet

instance FromJSONKey ChainMemberParsedSet

instance PrintfArg ChainMemberParsedSet where
  formatArg = formatString . (\case
    Everyone a -> "EVERYONE" ++ (show a)
    Org o a-> "ORG" ++ T.unpack o ++ (show a) 
    OrgUnit o u a-> "ORGUNIT" ++ T.unpack o ++ T.unpack u  ++ (show a)
    CommonName o u c a -> "COMMONNAME" ++ T.unpack o ++ T.unpack u  ++ T.unpack c ++ (show a))

instance ToSchema ChainMemberParsedSet where
  declareNamedSchema proxy = genericDeclareNamedSchema cmpsSchemaOptions proxy
    & mapped.schema.description ?~ "ChainMemberParsedSet"
    & mapped.schema.example ?~ toJSON exCMPSRespone

exCMPSRespone :: ChainMemberParsedSet
exCMPSRespone = CommonName "BlockApps" "Engineering" "Admin" True

-- | The model's field modifiers will match the JSON instances
cmpsSchemaOptions :: SchemaOptions
cmpsSchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }

type ChainMemberBounded = ChainMemberF BoundedData

newtype ChainMemberRange = ChainMemberRange { unChainMemberRange :: Range ChainMemberBounded } deriving (Show)

newtype IITTEXT = ITexter IText

type IText = DFI.Identity T.Text

newtype MaybeIITTEXT = MaybeITexter MaybeIText

type MaybeIText = DFI.Identity (Maybe T.Text)


rowToSet :: (Maybe Text, Maybe Text, Maybe Text, Bool) -> ChainMemberParsedSet
rowToSet (Nothing,_,_,a) = Everyone a
rowToSet ((Just o), Nothing, Nothing,a)  = Org o a
rowToSet ((Just o),(Just u), Nothing,a) = OrgUnit o u a 
rowToSet ((Just o),(Just u),(Just n),a) = CommonName o u n a
rowToSet ((Just o),Nothing,(Just n),a) = CommonName o "Nothing" n a

chainMemberParsedSetToChainMemberRSet :: ChainMemberParsedSet -> (Bool, ChainMemberRSet)
chainMemberParsedSetToChainMemberRSet (Everyone True)  = (True, ChainMemberRSet $ makeRangedSet
  [ getRangeFromBounds (ChainMemberF LowerBound LowerBound LowerBound) (ChainMemberF UpperBound UpperBound UpperBound)
  ])
chainMemberParsedSetToChainMemberRSet (Everyone False)  = (False, ChainMemberRSet rSetEmpty)
chainMemberParsedSetToChainMemberRSet (Org o True) = (True, ChainMemberRSet $  makeRangedSet
  [ getRangeFromBounds (ChainMemberF (Middle o) LowerBound LowerBound) (ChainMemberF (Middle o) UpperBound UpperBound)
  ])
chainMemberParsedSetToChainMemberRSet (Org o False) = (False, ChainMemberRSet $  makeRangedSet
  [ getRangeFromBounds (ChainMemberF LowerBound LowerBound LowerBound) (ChainMemberF (Middle o) LowerBound LowerBound)
  , getRangeFromBounds (ChainMemberF (Middle o) UpperBound UpperBound) (ChainMemberF UpperBound UpperBound UpperBound)
  ])
chainMemberParsedSetToChainMemberRSet (OrgUnit o u True) = (True, ChainMemberRSet $ makeRangedSet
  [ getRangeFromBounds (ChainMemberF (Middle o) (Middle $ Just u) LowerBound) (ChainMemberF (Middle o) (Middle $ Just u) UpperBound)
  ])
chainMemberParsedSetToChainMemberRSet (OrgUnit o u False) = (False, ChainMemberRSet $ makeRangedSet
  [ getRangeFromBounds (ChainMemberF LowerBound LowerBound LowerBound) (ChainMemberF (Middle o) (Middle $ Just u) LowerBound)
  , getRangeFromBounds (ChainMemberF (Middle o) (Middle $ Just u) UpperBound) (ChainMemberF UpperBound UpperBound UpperBound)
  ])
chainMemberParsedSetToChainMemberRSet (CommonName o u c True) = (True, ChainMemberRSet $ makeRangedSet
  [ getRangeFromBounds (ChainMemberF (Middle o) (Middle $ Just u) (Middle $ Just c)) (ChainMemberF (Middle o) (Middle $ Just u) (Middle $ Just c))
  ])
chainMemberParsedSetToChainMemberRSet (CommonName o u c False) = (False, ChainMemberRSet $ makeRangedSet
  [ getRangeFromBounds (ChainMemberF LowerBound LowerBound LowerBound) (ChainMemberF (Middle o) (Middle $ Just u) (Middle $ Just c))
  , getRangeFromBounds (ChainMemberF (Middle o) (Middle $ Just u) (Middle $ Just c)) (ChainMemberF UpperBound UpperBound UpperBound)
  ])


chainMembersToChainMemberRset :: ChainMembers -> ChainMemberRSet
chainMembersToChainMemberRset cms =
  let listOfCMPS  = S.toList $ unChainMembers cms
      listOfCMRSetWithBool = map chainMemberParsedSetToChainMemberRSet listOfCMPS
   in foldl' (\(ChainMemberRSet b) (access, ChainMemberRSet a) -> ChainMemberRSet $
        if access
          then rSetUnion a b
          else rSetIntersection a b) D.def listOfCMRSetWithBool

returnBoolOfChainMemberParsedSets :: ChainMemberParsedSet -> Bool
returnBoolOfChainMemberParsedSets (Everyone a) = a 
returnBoolOfChainMemberParsedSets (Org _ a) = a
returnBoolOfChainMemberParsedSets (OrgUnit _ _ a) = a
returnBoolOfChainMemberParsedSets (CommonName _ _ _ a) = a

getTrueChainMemberParsedSets :: ChainMembers -> ChainMembers
getTrueChainMemberParsedSets cms = ChainMembers $ S.fromList $ filter returnBoolOfChainMemberParsedSets (S.toList $ unChainMembers cms)

getFalseChainMemberParsedSets :: ChainMembers -> ChainMembers
getFalseChainMemberParsedSets cms = ChainMembers $ S.fromList $ filter (not . returnBoolOfChainMemberParsedSets) (S.toList $ unChainMembers cms)


getTextFromIdentity :: IText -> T.Text
getTextFromIdentity (DFI.Identity a ) = a


getTextFromIdentity' :: MaybeIText -> (Maybe T.Text)
getTextFromIdentity' (DFI.Identity a) = a


cmBoundedToRSet :: ChainMemberBounded ->  ChainMemberRSet
cmBoundedToRSet cm = ChainMemberRSet $ makeRangedSet[(getRangeFromBounds (fst (getBoundsFromCMBounded cm)) (snd (getBoundsFromCMBounded cm)))]


isChainMemberInRangeSet :: ChainMemberRSet -> ChainMemberRSet -> Bool
isChainMemberInRangeSet = rSetIsSubset `on` getChainMemberRSet


getRangeFromBounds :: ChainMemberBounded -> ChainMemberBounded -> Range ChainMemberBounded
getRangeFromBounds lb ub = (Range (BoundaryBelow lb) (BoundaryAbove ub)) 


getBoundsFromCMBounded :: ChainMemberBounded -> (ChainMemberBounded, ChainMemberBounded)
getBoundsFromCMBounded (ChainMemberF (Middle n) (Middle (Just u)) (Middle (Just c))) =
  ((ChainMemberF (Middle n) (Middle $ Just  u) (Middle $ Just c) ), (ChainMemberF (Middle n) (Middle (Just u)) (Middle $ Just c) ))
getBoundsFromCMBounded (ChainMemberF (Middle n) (Middle (Just u)) _) =
  ((ChainMemberF (Middle n) (Middle $ Just  u) LowerBound), (ChainMemberF (Middle n) (Middle (Just u)) UpperBound))
getBoundsFromCMBounded (ChainMemberF (Middle n) _ _ ) = 
  ((ChainMemberF (Middle n) LowerBound LowerBound ), (ChainMemberF (Middle n) UpperBound UpperBound ))
getBoundsFromCMBounded (ChainMemberF _ _ _ ) = 
  ((ChainMemberF LowerBound LowerBound LowerBound ), (ChainMemberF UpperBound UpperBound UpperBound ))


removeChainMember :: ChainMemberRSet -> ChainMemberBounded -> ChainMemberRSet
removeChainMember rangeSet cm = ChainMemberRSet (rSetDifference (getChainMemberRSet rangeSet) (getChainMemberRSet $ cmBoundedToRSet cm))


encodeChainMemberRSet :: ChainMemberRSet -> BSLI.ByteString
encodeChainMemberRSet cmrset = Data.Binary.encode cmrset


decodeChainMemberRSet :: BSLI.ByteString -> ChainMemberRSet
decodeChainMemberRSet byteString = Data.Binary.decode byteString


boolToString :: Bool -> String
boolToString True = "True" 
boolToString False = "False"

chainMemberParsedSetToString :: ChainMemberParsedSet -> String
chainMemberParsedSetToString (Everyone a)  = boolToString a
chainMemberParsedSetToString (Org o a) = "Org Name: "  ++ (T.unpack o) ++ "Access: " ++ (boolToString a)
chainMemberParsedSetToString (OrgUnit o u a) = "Org Name: "  ++ (T.unpack o) ++ "Org Unit: "  ++ (T.unpack u) ++ "Access: " ++ (boolToString a)
chainMemberParsedSetToString (CommonName o u c a) = "Org Name: "  ++ (T.unpack o) ++ "Org Unit: "  ++ (T.unpack u) ++ "Common Name: "  ++ (T.unpack c) ++"Access: " ++ (boolToString a)


instance Ord a => Ord (BoundedData a) where
  LowerBound `compare` LowerBound = EQ
  LowerBound `compare` _          = LT
  UpperBound `compare` UpperBound = EQ
  UpperBound `compare` _          = GT
  (Middle a) `compare` (Middle b) = a `compare` b
  (Middle _) `compare` LowerBound = GT
  (Middle _) `compare` UpperBound = LT




instance Ord (ChainMemberF BoundedData) where
  compare (ChainMemberF on1 ou1 cm1) (ChainMemberF on2 ou2 cm2) = case (compare on1 on2) of 
    EQ -> 
      case (compare ou1 ou2) of
        EQ -> (compare cm1 cm2)
        x -> x 
    y -> y


instance (DiscreteOrdered (ChainMemberF BoundedData)) where
  adjacent _ _= False
  adjacentBelow = const Nothing


instance (DiscreteOrdered (Range ChainMemberBounded)) where
  adjacent _ _= False
  adjacentBelow = const Nothing

instance NFData ChainMemberParsedSet where
  -- rnf (ChainMember (ChainMemberF (DFI.Identity on) (DFI.Identity ou) (DFI.Identity cn))) = on `seq` ou `seq` cn `seq` ()
  rnf (Everyone a)= a`seq` ()
  rnf (Org a b) = b `seq` a`seq` ()
  rnf (OrgUnit a b c) = c `seq` b `seq` a`seq` ()
  rnf (CommonName a b c d) = d `seq` c `seq` b `seq` a`seq` ()

-- instance Eq ChainMemberParsedSet where
--   cmr1 == cmr2 = toChainMemberRange cmr1 == toChainMemberRange cmr2



instance Eq (ChainMemberF BoundedData) where 
 (==) (ChainMemberF on1 ou1 cm1 ) (ChainMemberF on2 ou2 cm2) = (on1==on2 && ou1==ou2 && cm1==cm2)

instance Format ChainMemberParsedSet where
  format = show 


instance Show (ChainMemberF BoundedData) where
  show (ChainMemberF on' ou cm) = (show on') ++ " " ++ (show ou) ++ " " ++ (show cm) 


deriving instance Show (ChainMemberF DFI.Identity)


instance Binary a => Binary (BoundedData a) where

emptyChainMember :: ChainMemberParsedSet
emptyChainMember =  (Everyone False) --(Everyone a) (Org a b) (OrgUnit a b c) (CommonName a b c d)

instance Binary ChainMemberBounded where


instance Binary (ChainMemberF DFI.Identity)



instance Binary ChainMembers 

instance Binary ChainMemberParsedSet where

instance Binary ChainMemberRSet where
  get = do
    chainMemberRange <- get
    pure . ChainMemberRSet . makeRangedSet $ unChainMemberRange <$> chainMemberRange
  put (ChainMemberRSet rset) = do
    put $ ChainMemberRange <$> rSetRanges rset

instance Binary ChainMemberRange where
  get = do
    lb <- getBoundary
    ub <- getBoundary
    pure . ChainMemberRange $ Range lb ub
    where getBoundary = getWord8 >>= \case
            0 -> BoundaryAbove <$> get
            1 -> pure BoundaryAboveAll
            2 -> BoundaryBelow <$> get
            3 -> pure BoundaryBelowAll
            x -> fail $ "getBoundary: unknown boundary type: " ++ show x
  put (ChainMemberRange (Range x y)) = putBoundary x >> putBoundary y
    where putBoundary (BoundaryAbove z) = putWord8 0 >> put z
          putBoundary BoundaryAboveAll = putWord8 1 
          putBoundary (BoundaryBelow z) = putWord8 2 >> put z
          putBoundary BoundaryBelowAll = putWord8 3


instance RLPSerializable (IITTEXT) where 
  rlpEncode (ITexter (DFI.Identity a)) = rlpEncode a
  rlpDecode = ITexter . DFI.Identity . rlpDecode


instance RLPSerializable (MaybeIITTEXT) where 
  rlpEncode (MaybeITexter (DFI.Identity a)) = rlpEncode a
  rlpDecode = MaybeITexter . DFI.Identity . rlpDecode



instance RLPSerializable ChainMembers where
  rlpEncode (ChainMembers cms) = rlpEncode $ S.toList cms
  rlpDecode x = ChainMembers . S.fromList $ rlpDecode x

instance RLPSerializable (BoundedData Text) where
  rlpEncode (LowerBound)= RLPScalar 0
  rlpEncode (Middle a) = RLPArray [RLPScalar 1, rlpEncode a]
  rlpEncode (UpperBound)= RLPScalar 2
  rlpDecode (RLPScalar 0) = LowerBound
  rlpDecode (RLPArray [RLPScalar 1, a]) = Middle $ rlpDecode a
  rlpDecode (RLPScalar 2) = UpperBound
  rlpDecode _ = error ("Error in rlpDecode for BoundedData: bad RLPObject")


instance RLPSerializable (BoundedData (Maybe Text)) where
  rlpEncode (LowerBound)= RLPScalar 0
  rlpEncode (Middle(Just a)) = RLPArray [RLPScalar 1, rlpEncode a]
  rlpEncode (Middle Nothing) = RLPArray [RLPScalar 1]
  rlpEncode (UpperBound)= RLPScalar 2
  rlpDecode (RLPScalar 0) = LowerBound
  rlpDecode (RLPArray [RLPScalar 1, a]) = Middle $ Just $ rlpDecode a
  rlpDecode (RLPArray [RLPScalar 1]) = Middle Nothing
  rlpDecode (RLPScalar 2) = UpperBound
  rlpDecode _ = error ("Error in rlpDecode for BoundedData: bad RLPObject")


instance RLPSerializable ChainMemberBounded where
  rlpEncode (ChainMemberF on' ou cmn) = RLPArray
    [ rlpEncode on'
    , rlpEncode ou
    , rlpEncode cmn
    ]
  rlpDecode (RLPArray [on', ou, cmn]) =
    ChainMemberF
      (rlpDecode on')
      (rlpDecode ou)
      (rlpDecode cmn)
  rlpDecode o = error $ "rlpDecode ChainMember: Expected 3 element RLPArray, got " ++ show o

instance RLPSerializable ChainMemberRSet where
  rlpDecode = do
    chainMemberRange <- rlpDecode
    pure . ChainMemberRSet . makeRangedSet $ unChainMemberRange <$> chainMemberRange
  rlpEncode (ChainMemberRSet rset) = do
    rlpEncode $ ChainMemberRange <$> rSetRanges rset

instance RLPSerializable ChainMemberRange where
  rlpDecode(RLPArray[lb,ub]) = 
    (ChainMemberRange (Range ( getBoundary lb) (getBoundary ub)))
    where 
      getBoundary (RLPArray [RLPScalar t,s]) = case (t, s) of
                  (0, f)   -> BoundaryAbove $ rlpDecode f
                  (2, f)   -> BoundaryBelow $ rlpDecode f
                  _       ->  error $ "invalid shape for ChainMemberRange: "
      getBoundary (RLPArray [RLPScalar t]) = case (t) of    
                  (1)      -> BoundaryAboveAll
                  (3)      -> BoundaryBelowAll  
                  _        -> error $ "invalid shape for ChainMemberRange: "
      getBoundary _ = error $ "invalid shape for ChainMemberRange: "
  rlpDecode x = error $ "invalid shape for ChainMemberRange: " ++ show x
  rlpEncode (ChainMemberRange (Range x y)) = RLPArray[putBoundary x, putBoundary y]
    where putBoundary (BoundaryAbove z) = RLPArray [RLPScalar 0, rlpEncode z]
          putBoundary BoundaryAboveAll = RLPArray [RLPScalar 1]
          putBoundary (BoundaryBelow z) = RLPArray [RLPScalar 2, rlpEncode z]
          putBoundary BoundaryBelowAll = RLPArray [RLPScalar 3]
          


instance RLPSerializable ChainMemberParsedSet where
  rlpEncode (Everyone a)= RLPArray [rlpEncode a]
  rlpEncode (Org a b) = RLPArray [rlpEncode a, rlpEncode b]
  rlpEncode (OrgUnit a b c) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpEncode (CommonName a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, rlpEncode d]
  rlpDecode (RLPArray [a]) = Everyone (rlpDecode a) 
  rlpDecode (RLPArray [a,b]) = Org (rlpDecode a) (rlpDecode b) 
  rlpDecode (RLPArray [a,b,c]) = OrgUnit (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode (RLPArray [a,b,c,d]) = CommonName (rlpDecode a) (rlpDecode b) (rlpDecode c) (rlpDecode d)
  rlpDecode _ = error ("Error in rlpDecode for ChainMemberParsedSet: bad RLPObject")


-- instance ToJSONKey ChainMember

-- instance FromJSONKey ChainMember

instance RLPSerializable (S.Set ChainMemberParsedSet) where
  rlpEncode s = RLPArray $ rlpEncode <$> (S.toList s)
  rlpDecode (RLPArray cs) = S.fromList (rlpDecode <$> cs)
  rlpDecode x = error $ "rlpDecode for SignedCertificate Set failed: expected RLPArray, got " ++ show x


instance Arbitrary (ChainMemberF DFI.Identity) where
  arbitrary = genericArbitrary


instance Arbitrary ChainMembers where
  arbitrary = genericArbitrary


instance GEnum a => GEnum (BoundedData a)



instance Arbitrary ChainMemberParsedSet where
  arbitrary = GR.genericArbitrary GR.uniform


instance ToSchema ChainMembers where
  declareNamedSchema _ = return $
    NamedSchema (Just "ChainMembers") mempty


deriving instance Data (ChainMemberF DFI.Identity)  


-- instance FromJSON ChainMember where
--   parseJSON (Object o) = do
--     on <- o .: "orgName"
--     ou <- o .: "orgUnit"
--     cmn <- o .: "commonName"
--     return $ ChainMember (ChainMemberF on ou cmn) 
--   parseJSON x = error $ "couldn't parse JSON for chain member info: " ++ show x 

instance FromJSON ChainMembers where
  parseJSON (A.Array xs) = ChainMembers . S.fromList <$> traverse parseJSON (V.toList xs)
  parseJSON x = fail $ "couldn't parse JSON for chain members info: " ++ show x  

instance ToJSON ChainMembers where
  toJSON (ChainMembers xs) = toJSON (S.toList xs)
    -- traverse A.Array V.fromList 
    --  V.fromList <$> traverse A.Array toJSON 


instance FromJSON ChainMemberParsedSet where
  parseJSON (A.String s) = pure $ Org s True
  parseJSON (Object o) = do
    a <- fromMaybe True <$> (o .:? "access")
    o' <- o .:? "orgName"
    case o' of
      Nothing -> pure $ Everyone a
      Just org -> do
        u <- o .:? "orgUnit"
        case u of
          Nothing -> pure $ Org org a
          Just unit -> do
            c <- o .:? "commonName"
            case c of
              Nothing -> pure $ OrgUnit org unit a
              Just name -> pure $ CommonName org unit name a
  parseJSON o = fail $ "parseJSON ChainMembersParsedSet failed: expected object, got: " ++ show o


instance ToJSON ChainMemberParsedSet where
  toJSON (Everyone a) = object["access" .= a]
  toJSON (Org o a) = object["orgName".= o, "access" .= a]
  toJSON (OrgUnit o u a) = object["orgName".= o, "orgUnit".= u,"access" .= a]
  toJSON (CommonName o u c a) = object["orgName".= o, "orgUnit".= u, "commonName".=c, "access" .= a]



    
    -- A.Array (  <$> traverse parseJSON  (S.toList  xs))
  --   ChainMembers . S.fromList <$> traverse parseJSON (V.toList xs)
  -- toJSON (ChainMembers cm) =
  --   object [ "cm" .= cm
  --          ]

instance D.Default ChainMemberRSet where def = ChainMemberRSet rSetEmpty

instance D.Default ChainMembers  where def = ChainMembers S.empty

instance D.Default TrueOrgNameChains   where def = TrueOrgNameChains S.empty

instance D.Default FalseOrgNameChains   where def = FalseOrgNameChains S.empty

instance DPS.PersistField ChainMemberParsedSet where
  toPersistValue = DPS.PersistText . T.pack . show
  fromPersistValue (DPS.PersistText t) = Right . LabeledError.read "PersistField/ChainMemberParsedSet" . T.unpack $ t
  fromPersistValue x = Left . T.pack $ "PersistField ChainMemberParsedSet: expected string: " ++ show x

instance DPS.PersistFieldSql ChainMemberParsedSet where
  sqlType _ = DPS.SqlString




  