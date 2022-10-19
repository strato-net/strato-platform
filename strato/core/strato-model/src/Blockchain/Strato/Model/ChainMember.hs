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


module Blockchain.Strato.Model.ChainMember (
  -- OrgName(..),
  -- OrgUnit(..),
  -- CommonName(..),
  -- Access(..),
  getTextFromIdentity,
  getTextFromIdentity',
  toChainMemberRange,
  isDustinInBAEngTeam,
  ChainMemberF(..),
  ChainMember(..),
  ) where

import           Data.Aeson             hiding (Array, String)
import           Data.Binary        
import           Data.Data
import           GHC.Generics
import           Blockchain.Data.RLP
import qualified Data.Text                            as T
import           Test.QuickCheck.Instances.Text        ()
import           Text.Format
import qualified Data.Functor.Identity as DFI
import           Generics.Deriving 
import           Test.QuickCheck.Arbitrary
import           Test.QuickCheck.Arbitrary.Generic


data BoundedData a =  LowerBound | Middle a | UpperBound deriving (Eq, Generic)

newtype IITTEXT = ITexter IText
type IText = DFI.Identity T.Text

newtype MaybeIITTEXT = MaybeITexter MaybeIText
type MaybeIText = DFI.Identity (Maybe T.Text)


instance GEnum a => GEnum (BoundedData a)

-- {- For example only
instance Format ChainMember where
  format = show

instance Ord a => Ord (BoundedData a) where
  LowerBound `compare` LowerBound = EQ
  LowerBound `compare` _          = LT
  UpperBound `compare` UpperBound = EQ
  UpperBound `compare` _          = GT
  (Middle a) `compare` (Middle b) = a `compare` b
  (Middle _) `compare` LowerBound = GT
  (Middle _) `compare` UpperBound = LT


data ChainMemberF f = ChainMemberF
  { orgName    :: f T.Text
  , orgUnit    :: f (Maybe T.Text)
  , commonName :: f (Maybe T.Text)
  -- , access     :: f Text
  } deriving (Generic)


-- newtype ChainMemberNewType = ChainMemberNewType ChainMember
newtype ChainMember = ChainMember {getChainMember :: ChainMemberF DFI.Identity}  deriving (Generic, Data, Show)-- ChainMember { Text, Text, Text }

instance Eq ChainMember where
  cmr1 == cmr2 = toChainMemberRange cmr1 == toChainMemberRange cmr2

instance Ord ChainMember where
  compare cmr1 cmr2 = compare (toChainMemberRange cmr1) (toChainMemberRange cmr2)
 
type ChainMemberRange = ChainMemberF BoundedData

instance Eq (ChainMemberF BoundedData) where 
 (==) (ChainMemberF on1 ou1 cm1 ) (ChainMemberF on2 ou2 cm2) = (on1==on2 && ou1==ou2 && cm1==cm2)

instance Ord (ChainMemberF BoundedData) where
  compare (ChainMemberF on1 ou1 cm1) (ChainMemberF on2 ou2 cm2) = case (compare on1 on2) of 
    EQ -> 
      case (compare ou1 ou2) of
        EQ -> (compare cm1 cm2)
        x -> x 
    y -> y



getTextFromIdentity :: IText -> T.Text
getTextFromIdentity (DFI.Identity a ) = a

getTextFromIdentity' :: MaybeIText -> (Maybe T.Text)
getTextFromIdentity' (DFI.Identity a) = a

toChainMemberRange :: ChainMember -> ChainMemberRange
toChainMemberRange (ChainMember (ChainMemberF org unit cn)) = ChainMemberF (Middle $ getTextFromIdentity org) (Middle $ getTextFromIdentity' unit) (Middle $ getTextFromIdentity' cn)


isInRange :: ChainMemberRange -> ChainMemberRange -> ChainMember -> Bool
isInRange lowerBound upperBound cm =
  let cmr = toChainMemberRange cm
   in lowerBound <= cmr && cmr <= upperBound


isInBlockAppsEngineeringTeam :: ChainMember -> Bool
isInBlockAppsEngineeringTeam =
  let lb = ChainMemberF (Middle "BlockApps") (Middle $ Just "Engineering") LowerBound
      ub = ChainMemberF (Middle "BlockApps") (Middle $ Just "Engineering") UpperBound
   in isInRange lb ub


isDustinInBAEngTeam :: Bool
isDustinInBAEngTeam =
  let me = ChainMember (ChainMemberF (DFI.Identity "BlockApps") (DFI.Identity (Just "Engineering")) (DFI.Identity (Just "Dustin Norwood")))
   in isInBlockAppsEngineeringTeam me


instance RLPSerializable (IITTEXT) where 
  rlpEncode (ITexter (DFI.Identity a)) = rlpEncode a
  rlpDecode = ITexter . DFI.Identity . rlpDecode

instance RLPSerializable (MaybeIITTEXT) where 
  rlpEncode (MaybeITexter (DFI.Identity a)) = rlpEncode a
  rlpDecode = MaybeITexter . DFI.Identity . rlpDecode


instance RLPSerializable ChainMember where
  rlpEncode (ChainMember (ChainMemberF on ou cmn)) = RLPArray
    [ rlpEncode (ITexter on)
    , rlpEncode (MaybeITexter ou)
    , rlpEncode (MaybeITexter cmn)
    -- , rlpEncode a
    ]
  rlpDecode (RLPArray [on, ou, cmn]) =
    ChainMember ( ChainMemberF
      (removeItexter (rlpDecode on))
      (removeMaybeItexter (rlpDecode ou))
      (removeMaybeItexter (rlpDecode cmn)))
      -- (rlpDecode a)
  rlpDecode o = error $ "rlpDecode ChainMember: Expected 3 element RLPArray, got " ++ show o

removeItexter :: IITTEXT -> DFI.Identity T.Text
removeItexter (ITexter x) = x

removeMaybeItexter :: MaybeIITTEXT -> DFI.Identity (Maybe T.Text)
removeMaybeItexter (MaybeITexter x) = x

instance FromJSON ChainMember where
  parseJSON (Object o) = do
    on <- o .: "orgName"
    ou <- o .: "orgUnit"
    cmn <- o .: "commonName"
    -- a <- o.: "Access"
    return $ ChainMember (ChainMemberF on ou cmn) 
  parseJSON x = error $ "couldn't parse JSON for chain member info: " ++ show x 

instance ToJSON ChainMember where
  toJSON (ChainMember (ChainMemberF on ou cmn)) =
    object [ "orgName" .= on
            ,"orgUnit" .= ou
            ,"commonName" .=cmn
            -- ,"access" .=a
           ]

deriving instance Data (ChainMemberF DFI.Identity)  

deriving instance Show (ChainMemberF DFI.Identity)

instance Arbitrary (ChainMemberF DFI.Identity) where
  arbitrary = genericArbitrary

instance Arbitrary ChainMember where
  arbitrary = genericArbitrary 

instance Binary (ChainMemberF DFI.Identity)

instance Binary ChainMember