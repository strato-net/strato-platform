{-# LANGUAGE DeriveFunctor     #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE DeriveFoldable    #-}
{-# LANGUAGE DeriveTraversable #-}

module SolidVM.Model.CodeCollection.Event
  (
    EventF(..),
    Event,
    eventAnonymous,
    eventLogs,
    eventContext
  ) where

import           Control.Lens                hiding ((.=))
import           Data.Aeson
import           Data.Aeson.Types
import           Data.Source
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()

import qualified SolidVM.Model.CodeCollection.VarDef  as SolidVM

data EventF a = Event
  { _eventAnonymous :: Bool
  , _eventLogs :: [(Text, SolidVM.IndexedType)]
  , _eventContext :: a
  } deriving (Eq,Show,Generic, Functor, Foldable, Traversable)
makeLenses ''EventF

type Event = Positioned EventF

instance ToJSON a => ToJSON (EventF a) where
  toJSON e = object [
      "anonymous" .= _eventAnonymous e
    , "logs" .= _eventLogs e
    , "context" .= _eventContext e
    ]

instance FromJSON a => FromJSON (EventF a) where
  parseJSON (Object o) = Event
                     <$> (o .: "anonymous")
                     <*> (o .: "logs")
                     <*> (o .: "context")
  parseJSON o = typeMismatch "SolidVM.Event: Expected Object" o

instance Arbitrary a => Arbitrary (EventF a) where
  arbitrary = GR.genericArbitrary GR.uniform
