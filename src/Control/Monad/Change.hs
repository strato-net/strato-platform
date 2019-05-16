module Control.Monad.Change
  ( Modifiable(..)
  , Alters(..)
  , module Data.Proxy
  ) where

import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Data.Proxy
import Prelude                     hiding (lookup)
