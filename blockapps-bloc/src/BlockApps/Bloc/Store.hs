{-# LANGUAGE
    TemplateHaskell
  , TypeFamilies
#-}

module BlockApps.Bloc.Store where

import Control.Monad.Reader
import Data.Acid
import Data.IntMap (IntMap)
import qualified Data.IntMap as IntMap
import Data.List
import Data.SafeCopy
import Data.Text (Text)
import Data.Typeable

import BlockApps.Bloc.User

newtype Store = Store
  { users :: IntMap User } deriving (Show, Typeable)
$(deriveSafeCopy 0 'base ''Store)

usersQuery :: Query Store [Text]
usersQuery = sort . map userName . IntMap.elems . users <$> ask
$(makeAcidic ''Store ['usersQuery])
