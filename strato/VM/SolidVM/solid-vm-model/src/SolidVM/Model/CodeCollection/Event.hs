{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE DeriveAnyClass    #-}

module SolidVM.Model.CodeCollection.Event
  (
    EventF(..),
    Event
  ) where

import           Data.Aeson
import           Data.Aeson.Types
import           Control.DeepSeq
import           Data.Source
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import qualified SolidVM.Model.CodeCollection.VarDef  as SolidVM

data EventF a = Event
  { eventAnonymous :: Bool
  , eventLogs :: [(Text, SolidVM.IndexedType)]
  , eventContext :: a
  } deriving (Eq,Show,Generic, NFData, Functor)

type Event = Positioned EventF

instance ToJSON a => ToJSON (EventF a) where
  toJSON e = object [
      "anonymous" .= eventAnonymous e
    , "logs" .= eventLogs e
    , "context" .= eventContext e
    ]

instance FromJSON a => FromJSON (EventF a) where
  parseJSON (Object o) = Event
                     <$> (o .: "anonymous")
                     <*> (o .: "logs")
                     <*> (o .: "context")
  parseJSON o = typeMismatch "SolidVM.Event: Expected Object" o

instance Arbitrary a => Arbitrary (EventF a) where
  arbitrary = GR.genericArbitrary GR.uniform
