{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFoldable #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveTraversable #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Model.CodeCollection.Event where

import Control.DeepSeq
import Control.Lens hiding ((.=))
import Data.Aeson
import Data.Aeson.Types
import Data.Binary
import Data.Source
import Data.Text (Text)
import GHC.Generics
import qualified Generic.Random as GR
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import Test.QuickCheck
import Test.QuickCheck.Instances ()

data EventLog = EventLog
  { _eventLogName    :: Text
  , _eventLogIndexed :: Bool
  , _eventLogType    :: SolidVM.IndexedType
  } deriving (Eq, Show, Generic, NFData)

makeLenses ''EventLog

instance Binary EventLog

instance ToJSON EventLog where
  toJSON e =
    object
      [ "name" .= _eventLogName e,
        "indexed" .= _eventLogIndexed e,
        "type" .= _eventLogType e
      ]

instance FromJSON EventLog where
  parseJSON (Object o) =
    EventLog
      <$> (o .: "name")
      <*> (o .: "indexed")
      <*> (o .: "type")
  parseJSON o = typeMismatch "SolidVM.EventLog: Expected Object" o

instance Arbitrary EventLog where
  arbitrary = GR.genericArbitrary GR.uniform

--Changes to this structure should make a change to the unparser :)
data EventF a = Event
  { _eventAnonymous :: Bool,
    _eventLogs :: [EventLog],
    _eventContext :: a
  }
  deriving (Eq, Show, Generic, NFData, Functor, Foldable, Traversable)

makeLenses ''EventF

type Event = Positioned EventF

instance Binary a => Binary (EventF a)

instance ToJSON a => ToJSON (EventF a) where
  toJSON e =
    object
      [ "anonymous" .= _eventAnonymous e,
        "logs" .= _eventLogs e,
        "context" .= _eventContext e
      ]

instance FromJSON a => FromJSON (EventF a) where
  parseJSON (Object o) =
    Event
      <$> (o .: "anonymous")
      <*> (o .: "logs")
      <*> (o .: "context")
  parseJSON o = typeMismatch "SolidVM.Event: Expected Object" o

instance Arbitrary a => Arbitrary (EventF a) where
  arbitrary = GR.genericArbitrary GR.uniform
