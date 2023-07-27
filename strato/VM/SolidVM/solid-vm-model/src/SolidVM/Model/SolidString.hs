module SolidVM.Model.SolidString where

import Data.Text (Text)
import qualified Data.Text as T

type SolidString = String

labelToString :: SolidString -> String
labelToString = id

stringToLabel :: String -> SolidString
stringToLabel = id

labelToText :: SolidString -> Text
labelToText = T.pack

textToLabel :: Text -> SolidString
textToLabel = T.unpack

{-
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
