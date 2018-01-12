module Handler.PeerSpec where 

import TestImport
import Handler.Peers
import qualified Test.HUnit as HUnit
import Network.Wai.Test (simpleBody)

-- TODO(tim): TestImport currently only sets up PGDATABASE:eth
-- but not PGDATABASE:eth_3612126f2820906d85fffe692f8b296a69fd3a9c
-- for its peer, which is why this test is excluded.
spec :: Spec
spec = withApp $ do
  it "lists peers" $ do
      get PeersR
      withResponse (\res ->
        let text = simpleBody res
        in liftIO $ HUnit.assertBool (show text) False)
      statusIs 200 
