module Strato.Strato23.Server.Key where

import           Data.Text                        (Text)
import           Strato.Strato23.Monad
import           Strato.Strato23.API.Key
import           Strato.Strato23.API.Types

postKey :: T.Text -> VaultM Address
postKey userId = return (Address 0)
