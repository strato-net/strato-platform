{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Strato.Model.ChainId
  ( ChainId (..),
    chainIdString,
    stringChainId,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq (NFData)
import Control.Lens.Operators
import Data.Aeson hiding (Array, String)
import qualified Data.Aeson.Encoding as AesonEnc
import qualified Data.Aeson.Key as DAK
import qualified Data.Binary as Binary
import Data.Either.Extra (maybeToEither)
import Data.Hashable
import Data.Swagger
import qualified Data.Text as Text
import Database.Persist.Sql
import GHC.Generics
import Numeric
import Servant.API
import Servant.Docs
import Test.QuickCheck hiding ((.&.))
import Text.Read hiding (String)
import Web.FormUrlEncoded hiding (fieldLabelModifier)

newtype ChainId = ChainId {unChainId :: Word256}
  deriving (Eq, Ord, Generic, Bounded)
  deriving newtype (Hashable)
  deriving anyclass (NFData, Binary.Binary)

instance Show ChainId where show = chainIdString

instance ToJSONKey ChainId where
  toJSONKey = ToJSONKeyText f g
    where
      f x = DAK.fromText . Text.pack $ chainIdString x
      g x = AesonEnc.text . Text.pack $ chainIdString x

instance PersistField ChainId where
  toPersistValue = PersistText . Text.pack . chainIdString
  fromPersistValue (PersistText t) =
    let !eCid = maybeToEither "could not decode chainid"
              . stringChainId
              . Text.unpack
              $ t
     in eCid
  fromPersistValue x =
    Left . Text.pack $
      "PersistField ChainId: expected PersistText: " ++ show x

instance PersistFieldSql ChainId where
  sqlType _ = SqlOther "text"

chainIdString :: ChainId -> String
chainIdString = show256 . unChainId

stringChainId :: String -> Maybe ChainId
stringChainId string = ChainId . fromInteger <$> readMaybe ("0x" ++ string)

instance ToJSON ChainId where toJSON = toJSON . chainIdString

instance FromJSON ChainId where
  parseJSON value = do
    string <- parseJSON value
    case stringChainId string of
      Nothing -> fail $ "Could not decode ChainId: " <> string
      Just chainId -> return chainId

instance ToHttpApiData ChainId where
  toUrlPiece = Text.pack . chainIdString

instance FromHttpApiData ChainId where
  parseUrlPiece text = case stringChainId (Text.unpack text) of
    Nothing -> Left $ "Could not decode ChainId: " <> text
    Just chainId -> Right chainId

instance ToForm ChainId where
  toForm chainId = [("chainid", toQueryParam chainId)]

instance FromForm ChainId where fromForm = parseUnique "chainid"

instance Arbitrary ChainId where
  arbitrary = ChainId . fromInteger <$> arbitrary

instance ToSample ChainId where
  toSamples _ = samples [ChainId 0xdeadbeef, ChainId 0x12345678]

instance ToCapture (Capture "chainid" ChainId) where
  toCapture _ = DocCapture "chainid" "a private chain Id"

instance RLPSerializable ChainId where
  rlpEncode (ChainId n) = rlpEncode n
  rlpDecode obj = ChainId $ rlpDecode obj

instance ToParam (QueryParam "chainid" ChainId) where
  toParam _ = DocQueryParam "chainid" [] "Blockchain Identifier" Normal

instance ToParamSchema ChainId where
  toParamSchema _ =
    mempty
      & type_ ?~ SwaggerString
      & minimum_ ?~ fromInteger (toInteger . unChainId $ (minBound :: ChainId))
      & maximum_ ?~ fromInteger (toInteger . unChainId $ (maxBound :: ChainId))
      & format ?~ "hex string"

instance ToSchema ChainId where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "ChainId")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ "ec41a0a4da1f33ee9a757f4fd27c2a1a57313353375860388c66edc562ddc781"
            & description ?~ "Private chain id, 32 byte hex encoded string"
        )

show256 :: Word256 -> String
show256 = padZeros 64 . flip showHex ""

padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string
