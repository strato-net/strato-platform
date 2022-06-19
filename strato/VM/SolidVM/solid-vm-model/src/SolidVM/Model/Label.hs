
module SolidVM.Model.Label where

import Data.Text (Text)
import qualified Data.Text as T


type Label = String

labelToString :: Label -> String
labelToString = id

stringToLabel :: String -> Label
stringToLabel = id

labelToText :: Label -> Text
labelToText = T.pack

textToLabel :: Text -> Label
textToLabel = T.unpack


{-
type Label = Text

labelToString :: Label -> String
labelToString = T.unpack

stringToLabel :: String -> Label
stringToLabel = T.pack

labelToText :: Label -> Text
labelToText = id

textToLabel :: Text -> Label
textToLabel = id
-}
