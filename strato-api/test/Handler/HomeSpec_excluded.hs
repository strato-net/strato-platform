module Handler.HomeSpec (spec) where

import TestImport

import Blockchain.Data.DataDefs

spec :: Spec
spec = withApp $ do
    it "loads the index and checks it looks right" $ do
        get HomeR
        statusIs 200
        htmlAllContain "h1" "BlockApps.net"
    it "check count of h1" $ do
        get HomeR
        statusIs 200
        htmlCount "h1" 1