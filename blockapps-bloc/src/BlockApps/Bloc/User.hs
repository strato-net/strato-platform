{-# LANGUAGE
    TemplateHaskell
#-}

module BlockApps.Bloc.User where

import Data.ByteString (ByteString)
import Data.SafeCopy
import Data.Text (Text)
import Data.Typeable

-- import BlockApps.Data

data User = User
  { userName :: Text
  , passwordHash :: ByteString
  , addresses :: [Text] -- use Address
  } deriving (Eq,Show,Typeable)
$(deriveSafeCopy 0 'base ''User)
