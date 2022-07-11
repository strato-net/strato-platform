{-# LANGUAGE OverloadedStrings #-}

module TxrIndexerSpec where

import           Test.Hspec

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Indexer.TxrIndexer

spec :: Spec
spec = do
    describe "indexEventToTxrResults properly indexes events into txr results" $ do
        it "Index EventDBEntry for MemberAdded" $
            let addr = fromInteger 0x3023
                chainId = fromInteger 0x4920
                orgId = OrgId "6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0"
                enode = Enode orgId (IPv4 $ fromInteger 192) 80 Nothing
                event = EventDB (Just chainId) "MemberAdded" [show addr, showEnode enode]
            in indexEventToTxrResults (EventDBEntry event) 
                `shouldBe` [PutEventDB event, AddMember $ Right (chainId, addr, enode)]
        it "Index EventDBEntry for MemberRemoved" $
            let addr = fromInteger 0x1011
                chainId = fromInteger 0x8203
                event = EventDB (Just chainId) "MemberRemoved" [show addr]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, RemoveMember $ Right (chainId, addr)]
        -- it "Index EventDBEntry for CertificateRegistered" $
        --     let uAddr = fromInteger 0x1234
        --         cAddr = fromInteger 0x5678
        --         event = EventDB Nothing "CertificateRegistered" [show uAddr, show cAddr]
        --     in indexEventToTxrResults (EventDBEntry event)
        --         `shouldBe` [PutEventDB event, RegisterCertificate $ Right (uAddr, cAddr)]
        it "Index EventDBEntry for non-special event" $
            let chainId = fromInteger 0x480244
                event = EventDB (Just chainId) "NotSpecial" ["48193"]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event]
