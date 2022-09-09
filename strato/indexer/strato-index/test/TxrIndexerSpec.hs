{-# LANGUAGE OverloadedStrings #-}

module TxrIndexerSpec where

import qualified Data.ByteString.Char8              as C8
-- import qualified Data.ByteString                    as BS
import           Data.Either

import           Test.Hspec

import           BlockApps.X509.Certificate
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
        it "Index EventDBEntry for CertificateRegistered" $
            let certString = unlines
                    [ "-----BEGIN CERTIFICATE-----"
                    , "MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI"
                    , "MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF"
                    , "bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy"
                    , "MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU"
                    , "MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG"
                    , "BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs"
                    , "9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8"
                    , "R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n"
                    , "N8txKc8G9R27ZYAUuz15zF0="
                    , "-----END CERTIFICATE-----"
                    ]
                event = EventDB Nothing "CertificateRegistered" [certString]
                parsedCert = fromRight (error "Couldn't parse certString") $ bsToCert $ C8.pack $ certString
                addr = fromInteger 0x74f014fef932d2728c6c7e2b4d3b88ac37a7e1d0
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, RegisterCertificate $ Right (addr, X509CertInfoState{userAddress=addr, certificate=parsedCert, isValid=True, children=[], orgName="", orgUnit=Nothing})]
        it "Index EventDB for CertificateRevoked" $
            let userAddr = fromInteger 0x489384
                event = EventDB Nothing "CertificateRevoked" [show userAddr]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, CertificateRevoked . Right $ userAddr]
        it "Index EventDB for CertificateRegistryInitialized" $
            let event = EventDB Nothing "CertificateRegistryInitialized" []
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, CertificateRegistryInitialized . Right $ ()]
        it "Index EventDBEntry for non-special event" $
            let chainId = fromInteger 0x480244
                event = EventDB (Just chainId) "NotSpecial" ["48193"]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event]
        it "Index EventDBEntry for OrganizationAdded (one argument)" $
            let cId   = fromInteger 0x42069
                event = EventDB (Just cId) "OrganizationAdded" ["blockapps"]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, AddOrgName $ Right (cId, ("blockapps", Nothing))] 
        it "Index EventDBEntry for OrganizationAdded (two arguments)" $
            let cId   = fromInteger 0x22222
                event = EventDB (Just cId) "OrganizationAdded" ["blockapps", "sales"]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, AddOrgName $ Right (cId, ("blockapps", Just "sales"))] 
        it "Index EventDBEntry for OrganizationRemoved (one argument)" $
            let cId   = fromInteger 0x33333
                event = EventDB (Just cId) "OrganizationRemoved" ["blockapps"]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, RemoveOrgName $ Right (cId, ("blockapps", Nothing))] 
        it "Index EventDBEntry for OrganizationRemoved (two arguments)" $
            let cId   = fromInteger 0x11111
                event = EventDB (Just cId) "OrganizationRemoved" ["blockapps", "engineering"]
            in indexEventToTxrResults (EventDBEntry event)
                `shouldBe` [PutEventDB event, RemoveOrgName $ Right (cId, ("blockapps", Just "engineering"))] 
