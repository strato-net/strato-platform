module Handler.RamlSpec where

import TestImport

spec :: Spec
spec = withApp $ do
  it "lists raml docs" $ do
      get ("/eth/v1.2/raml" :: Text)
      statusIs 200
      mapM bodyContains [ "/faucet"
                        , "/stats"
                        , "/uuid"
                        , "/block"
                        , "/log"
                        , "/account"
                        , "/transaction"
                        , "/storage"
                        , "/register"
                        , "/wallet"
                        , "/developer"
                        , "/coinbase"
                        , "/peers"
                        ]

