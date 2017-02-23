module BlockApps.Bloc.User where

import Data.Text (Text)

import BlockApps.Ethereum

data User = User
  { userName :: Text
  , userPasswordHash :: Text
  , userAddress :: Address
  } deriving (Eq, Ord, Show)
