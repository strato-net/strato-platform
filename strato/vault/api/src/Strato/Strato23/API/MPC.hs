{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- | MPC (2-of-2) key shard storage. These routes are entirely separate from the
-- existing key/signature routes so backwards compatibility is preserved. The
-- wallet generates a key, splits it 2-of-2, keeps one shard, and stores the other
-- (the "Vault shard") here; at signing time it fetches the Vault shard back,
-- reconstructs the key client-side, signs, and discards it. Vault never assembles
-- the key or signs — it is a dumb encrypted-shard store.
module Strato.Strato23.API.MPC where

import Data.Aeson.Types
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.OpenApi (ToSchema (..), binarySchema)
import Data.OpenApi.Internal.Schema (named)
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics
import qualified LabeledError
import Servant.API
import Strato.Strato23.API.Types (Address)

-- | A key shard (raw secp256k1 scalar bytes, hex-encoded in JSON) plus the
-- account's address. Used both to store the Vault shard (POST body) and to return
-- it (GET response).
data MPCKeyShare = MPCKeyShare
  { mksShard :: B.ByteString,
    mksAddress :: Address
  }
  deriving (Eq, Show, Generic)

instance ToJSON MPCKeyShare where
  toJSON (MPCKeyShare shard addr) =
    object
      [ "shard" .= (T.pack . C8.unpack . B16.encode $ shard),
        "address" .= addr
      ]

instance FromJSON MPCKeyShare where
  parseJSON (Object o) = do
    s <- o .: "shard"
    a <- o .: "address"
    return $ MPCKeyShare (LabeledError.b16Decode "FromJSON<MPCKeyShare>" . C8.pack $ T.unpack s) a
  parseJSON x = error $ "parseJSON MPCKeyShare: expected object, got " ++ show x

instance ToSchema MPCKeyShare where
  declareNamedSchema = const . pure $ named "MPCKeyShare" binarySchema

-- | Confirmation returned after storing a shard (no shard echoed back).
data MPCKeyMeta = MPCKeyMeta {mkmAddress :: Address}
  deriving (Eq, Show, Generic)

instance ToJSON MPCKeyMeta where
  toJSON (MPCKeyMeta a) = object ["status" .= ("success" :: Text), "address" .= a]

instance FromJSON MPCKeyMeta where
  parseJSON (Object o) = MPCKeyMeta <$> o .: "address"
  parseJSON x = error $ "parseJSON MPCKeyMeta: expected object, got " ++ show x

instance ToSchema MPCKeyMeta where
  declareNamedSchema = const . pure $ named "MPCKeyMeta" binarySchema

--------------------------------------------------------------------------------
-- Routes (JWT-gated like the other v2.3 routes: nginx validates the bearer token
-- and injects the user-name / identity-provider headers).
--------------------------------------------------------------------------------

-- | Store the Vault shard for the authenticated user. Fails if one already exists.
type PostMPCKey' =
  "mpckey"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> ReqBody '[JSON] MPCKeyShare
    :> Post '[JSON] MPCKeyMeta

-- | Return the Vault shard for the authenticated user (for client-side signing).
type GetMPCKey' =
  "mpckey"
    :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
    :> Header' '[Required, Strict] "X-IDENTITY-PROVIDER-ID" Text
    :> Get '[JSON] MPCKeyShare
