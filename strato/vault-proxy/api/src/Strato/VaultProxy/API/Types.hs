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

-- import           Control.Lens                 hiding ((.=))
-- import           Data.Aeson.Casing
-- import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types             hiding (fieldLabelModifier)
-- import qualified Data.ByteString              as B
-- import qualified Data.ByteString.Base16       as B16
-- import qualified Data.ByteString.Char8        as C8
import           Data.Cache
-- import           Data.Scientific              as Scientific
import qualified Data.Text                    as T
import           Data.Swagger
-- import           Data.Swagger.Internal.Schema (named)

-- import           GHC.Conc
import           GHC.Generics

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1
import           Strato.VaultProxy.DataTypes
-- import qualified LabeledError


data User = User
  { username :: T.Text
  , address :: Address
  } deriving (Eq, Show, Generic, ToJSON, FromJSON, ToSchema)

type VaultCache = Cache T.Text VaultToken
