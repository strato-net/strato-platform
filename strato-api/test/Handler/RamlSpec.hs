module Handler.RamlSpec where 

import TestImport
import Network.Wai.Test (simpleBody)

spec :: Spec
spec = withApp $ do
  it "lists raml docs" $ do
      get ("/eth/v1.2/raml" :: Text)
      statusIs 200
      mapM bodyContains [ "/faucet"
                        , "/extabi"
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
      
