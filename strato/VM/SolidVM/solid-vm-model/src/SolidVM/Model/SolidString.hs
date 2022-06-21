{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module SolidVM.Model.SolidString where

import Control.DeepSeq
import Data.Aeson
import Data.Binary
import Data.Hashable
import Data.String
import Data.Swagger
import Data.Text (Text)
import qualified Data.Text as T
import Test.QuickCheck
import Test.QuickCheck.Instances.Text        ()

import Blockchain.Data.RLP

newtype SolidString = SolidString Text deriving (Show, Eq, Ord, NFData, Hashable, Binary, RLPSerializable, Arbitrary, ToJSON, ToJSONKey, FromJSON, FromJSONKey, ToSchema)

instance IsString SolidString where
  fromString x = SolidString $ T.pack x

labelToString :: SolidString -> String
labelToString (SolidString t) = T.unpack t

stringToLabel :: String -> SolidString
stringToLabel = SolidString . T.pack

labelToText :: SolidString -> Text
labelToText (SolidString t) = t

textToLabel :: Text -> SolidString
textToLabel = SolidString



{-
type SolidString = String

labelToString :: SolidString -> String
labelToString = id

stringToLabel :: String -> SolidString
stringToLabel = id

labelToText :: SolidString -> Text
labelToText = T.pack

textToLabel :: Text -> SolidString
textToLabel = T.unpack



type SolidString = Text

labelToString :: SolidString -> String
labelToString = T.unpack

stringToLabel :: String -> SolidString
stringToLabel = T.pack

labelToText :: SolidString -> Text
labelToText = id

textToLabel :: Text -> SolidString
textToLabel = id
-}
