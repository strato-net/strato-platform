module Strato.Strato23.Server.Key where

import           Data.Text             (Text)
import           Strato.Strato23.Monad
import           Strato.Strato23.API

postKey :: Maybe Text -> VaultM Address
postKey _ = return (Address 0)
