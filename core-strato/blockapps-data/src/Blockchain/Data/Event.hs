module Blockchain.Data.Event(
  Event(..)
  ) where

import           Control.DeepSeq
import           GHC.Generics


data Event =
  Event {
    evName   :: String,
    evArgs   :: [String] -- TODO: probably think of better types, fields for this
    } deriving (Eq, Read, Show, Generic)

instance NFData Event
