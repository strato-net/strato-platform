{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

module Bloc.API.DeprecatedPostTransaction where

import Bloc.API.TypeWrappers
import Blockchain.Data.AlternateTransaction ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256
import Control.Lens (mapped, (&), (?~))
import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Casing.Internal (dropFPrefix)
import qualified Data.Binary as Binary
import qualified Data.ByteString.Lazy as BL
import Data.Map.Strict (Map)
import Data.Swagger
import qualified Data.Swagger as Sw
import Data.Text (Text)
import Data.Word
import GHC.Generics
import qualified Generic.Random as GR
import Numeric.Natural
import Test.QuickCheck

data PostTransaction = PostTransaction
  { posttransactionHash :: Keccak256,
    posttransactionGasLimit :: Natural,
    posttransactionCodeOrData :: Text,
    posttransactionGasPrice :: Natural,
    posttransactionTo :: Maybe Address,
    posttransactionFrom :: Address,
    posttransactionValue :: Strung Natural,
    posttransactionR :: Hex Natural,
    posttransactionS :: Hex Natural,
    posttransactionV :: Hex Word8,
    posttransactionNonce :: Natural,
    posttransactionChainId :: Maybe ChainId,
    posttransactionMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

instance FromJSON PostTransaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON PostTransaction where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance Arbitrary PostTransaction where
  arbitrary = GR.genericArbitrary GR.uniform

{-
instance ToSample PostTransaction where
  toSamples _ = singleSample defaultPostTx
-}
defaultPostTx :: PostTransaction -- TODO: Make this a real default
defaultPostTx =
  PostTransaction
    { posttransactionHash = hash $ BL.toStrict (Binary.encode @Integer 1),
      posttransactionGasLimit = 21000,
      posttransactionCodeOrData = "",
      posttransactionGasPrice = 50000000000,
      posttransactionTo = Just $ Address 0xdeadbeef,
      posttransactionFrom = Address 0x111dec89c25cbda1c12d67621ee3c10ddb8196bf,
      posttransactionValue = Strung 10000000000000000000,
      posttransactionR = Hex 1, -- make valid examples
      posttransactionS = Hex 1, -- make valid examples
      posttransactionV = Hex 0x1c,
      posttransactionNonce = 0,
      posttransactionChainId = Nothing,
      posttransactionMetadata = Nothing
    }

instance ToSchema PostTransaction where
  declareNamedSchema proxy =
    genericDeclareNamedSchema stratoSchemaOptions proxy
      & mapped . schema . description ?~ "Post Transaction"
      & mapped . schema . example ?~ toJSON defaultPostTx

-------------

------------

stratoSchemaOptions :: SchemaOptions
stratoSchemaOptions = defaultSchemaOptions {Sw.fieldLabelModifier = camelCase . dropFPrefix}
