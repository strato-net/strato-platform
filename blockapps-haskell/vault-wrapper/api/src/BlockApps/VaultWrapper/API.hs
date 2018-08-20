{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.VaultWrapper.API where

import           Data.Text                    (Text)
import           Servant.API

import           BlockApps.Ethereum           (Address(..))
import           BlockApps.VaultWrapper.Types

type API =
  "_ping"
    :> Get '[JSON] String
  :<|> "key"
    :> Header "X-USER-UNIQUE-NAME" Text -- Guess what? Our version of Servant is too old to make headers Required!
    :> Header "X-USER-ID" Text
    :> Post '[JSON] Address
  :<|> "signature"
    :> Header "X-USER-UNIQUE-NAME" Text
    :> Header "X-USER-ID" Text
    :> ReqBody '[JSON] UserData
    :> Post '[JSON] SignatureDetails
