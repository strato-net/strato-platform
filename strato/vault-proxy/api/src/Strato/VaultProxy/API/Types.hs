{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.VaultProxy.API.Types
  ( module Strato.VaultProxy.API.Types
  , Address(..)
  , Signature(..) -- TODO: remove, ideally
  , PublicKey(..) --       same
  , SharedKey(..) --       same
  ) where

import           Data.Aeson.Types             hiding (fieldLabelModifier)
import           Data.Cache
import qualified Data.Text                    as T
import           Data.Swagger

import           GHC.Generics

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1
import           Strato.VaultProxy.DataTypes


data User = User
  { username :: T.Text
  , address :: Address
  } deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)

type VaultCache = Cache T.Text VaultToken
