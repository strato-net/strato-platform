{-# LANGUAGE
    TypeFamilies
#-}

module BlockApps.Bloc.Store where

import Data.Set (Set)

import BlockApps.Bloc.User

newtype Store = Store
  { users :: Set User } deriving (Show)
