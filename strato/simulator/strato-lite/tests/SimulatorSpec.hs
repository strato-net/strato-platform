{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PackageImports        #-}
{-# LANGUAGE QuasiQuotes           #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module SimulatorSpec where

import           Prelude hiding (round)
import           Conduit
import           Control.Concurrent.STM.TMChan
import           Control.Lens                          hiding (Context, view)
import           Control.Monad.Reader
import qualified Data.ByteString.Char8                 as BC
import           Data.Foldable                         (for_)
import qualified Data.Map.Strict                       as M
import qualified Data.Set                              as Set
import qualified Data.Text                             as T
import           Data.Text.Encoding

import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.Messages      (round)
import           Blockchain.Blockstanbul.StateMachine
-- import           Blockchain.Data.AddressStateDB
import qualified Blockchain.Data.AlternateTransaction  as U
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Block                 hiding (bestBlockNumber)
import           Blockchain.Data.BlockDB()
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.TransactionDef
import qualified Blockchain.Data.TXOrigin              as Origin
import           BlockApps.X509.Certificate           

import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad

import           Blockchain.Strato.Discovery.Data.Peer hiding (createPeer)
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import qualified Blockchain.Strato.Model.ChainMember   as CM
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.MicroTime
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.Wei

import           Strato.Lite


import           Test.Hspec
import           Test.QuickCheck
import           Text.RawString.QQ

import           UnliftIO
import           UnliftIO.Concurrent                   (threadDelay)

createPeer' :: PrivateKey -> [Address] -> T.Text -> T.Text -> IO P2PPeer
createPeer' pk as n ip = do
  inet <- newTVarIO preAlGoreInternet
  createPeer pk as inet n (IPAsText ip) (TCPPort 30303) (UDPPort 30303) []
                          
spec :: Spec
spec = do
  describe "network simulation" $ do
    it "should send a transaction from server to client" $ do
      serverPKey <- newPrivateKey
      clientPKey <- newPrivateKey
      let validatorAddresses = makeValidators [serverPKey, clientPKey]
      server' <- createPeer' serverPKey validatorAddresses "server" "1.2.3.4"
      client' <- createPeer' clientPKey validatorAddresses "client" "5.6.7.8"
      connection <- createConnection server' client'
      let clearChainId tx = case tx of
            MessageTX{} -> tx{transactionChainId = Nothing}
            ContractCreationTX{} -> tx{transactionChainId = Nothing}
            PrivateHashTX{} -> tx
      otx <- (\o -> o{otBaseTx = clearChainId (otBaseTx o), otOrigin = Origin.API}) <$> liftIO (generate arbitrary)
      let runForTwoSeconds = timeout 2000000
          run = runForTwoSeconds $ runConnection connection
          postTxEvent = threadDelay 500000 >> (atomically $ writeTMChan (_p2pPeerSeqP2pSource server') (Right $ P2pTx otx))
      concurrently_ run postTxEvent
      serverCtx <- readTVarIO $ server' ^. p2pTestContext
      clientCtx <- readTVarIO $ client' ^. p2pTestContext
      _unseqEvents serverCtx `shouldBe` []
      let clientTxs = [t | IETx _ (IngestTx _ t) <- _unseqEvents clientCtx]
      clientTxs `shouldBe` [otBaseTx otx]

    it "should update the round number on every node in the network" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..7]
      let validatorsPrivKeys' = take 2 privKeys
          validatorAddresses = makeValidators validatorsPrivKeys'
      peers <- traverse (\(p,(n,i)) -> createPeer' p validatorAddresses n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        , ("node4", "13.14.15.16")
        , ("node5", "17.18.19.20")
        , ("node6", "21.22.23.24")
        , ("node7", "25.26.27.28")
        ]
      let validators' = take 2 peers
      connections' <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 0, peers !! 3)
        , (peers !! 0, peers !! 4)
        , (peers !! 0, peers !! 5)
        , (peers !! 0, peers !! 6)
        , (peers !! 1, peers !! 2)
        , (peers !! 1, peers !! 3)
        , (peers !! 1, peers !! 4)
        , (peers !! 1, peers !! 5)
        ]
      let runForTwoSeconds = void . timeout 2000000
          postTimeoutEvent = do
            threadDelay 1000000
            for_ validators' $ postEvent (TimerFire 0)
      runForTwoSeconds $ concurrently_ (runNetworkOld peers connections') postTimeoutEvent
      ctxs <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1 :: Maybe Word256)
  

    it "should update the round number after failing on a divided network first" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..3]
      let validatorsPrivKeys' = privKeys
          primaryValidatorsPrivKeys = [head validatorsPrivKeys']
          primaryValidatorAddresses = makeValidators primaryValidatorsPrivKeys
          validatorAddresses = makeValidators validatorsPrivKeys'
      peers <- traverse (\(p,(n,i)) -> createPeer' p primaryValidatorAddresses n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        ]
      let validators' = peers
          primaryValidators = [head validators']
          secondaryValidators = tail validators'
      connections' <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 1, peers !! 2)
        ]
      atomically $ modifyTVar' ((peers !! 1) ^. p2pTestContext)
                               ( (sequencerContext . blockstanbulContext . _Just . validators .~ Set.fromList validatorAddresses)
                               . (sequencerContext . blockstanbulContext . _Just . view . round .~ 1000))
      atomically $ modifyTVar' ((peers !! 2) ^. p2pTestContext)
                               ( (sequencerContext . blockstanbulContext . _Just . validators .~ Set.fromList validatorAddresses)
                               . (sequencerContext . blockstanbulContext . _Just . view . round .~ 1000))
      let runForTwoSeconds = void . timeout 2000000
          postTimeoutPrimary1 = do
            threadDelay 1000000
            for_ primaryValidators $ postEvent (TimerFire 0)
          postTimeoutPrimary2 = do
            threadDelay 1000000
            for_ primaryValidators $ postEvent (TimerFire 1)
          postTimeoutSecondary = do
            threadDelay 1000000
            for_ secondaryValidators $ postEvent (TimerFire 1000)
      runForTwoSeconds $ concurrently_ (runNetworkOld peers connections') (concurrently_ postTimeoutPrimary1 postTimeoutSecondary)
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs1 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, if i == 0 then Just (1 :: Word256) else Just 1000)
      atomically $ modifyTVar' ((peers !! 0) ^. p2pTestContext)
                               (sequencerContext . blockstanbulContext . _Just . validators .~ Set.fromList validatorAddresses)
      runForTwoSeconds $ concurrently_ (runNetworkOld peers connections') (concurrently_ postTimeoutPrimary2 postTimeoutSecondary)
      ctxs2 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs2 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1001 :: Maybe Word256)

    it "can add a new node to a chain" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..3]
      let validators' = makeValidators privKeys
      peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        ]
      connections' <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 1, peers !! 2)
        ]
      
      registryTs <- liftIO getCurrentMicrotime

      let runForThreeSeconds = void . timeout 3000000
          toIetx = IETx registryTs . IngestTx Origin.API
          chainMember1 = (CM.ChainMembers $ Set.singleton $ (CM.CommonName (T.pack "BlockApps") (T.pack "engineering") (T.pack "David Nallapu") True))
                -- Create a certificate registry on the main chain
          iss   = Issuer {  issCommonName = "David Nallapu"
                          , issOrg        = "Blockapps"
                          , issUnit       = Just "engineering"
                          , issCountry    = Just "USA"
                          }
          subj  = Subject { subCommonName = "Garrett"
                          , subOrg        = "Blockapps"
                          , subUnit       = Just "engineering"
                          , subCountry    = Just "USA"
                          , subPub        = derivePublicKey (privKeys !! 1)
                          } 
      cert <- makeSignedCert Nothing (Just rootCert) iss subj
      let cert' = decodeUtf8 . certToBytes $ cert
          args' = "(0x" <> (T.pack $ (formatAddressWithoutColor . fromPrivateKey) (privKeys !! 0)) <> ", \"" <> cert' <>"\")"
          registry = [r|
                pragma solidvm 3.0;
                contract CertRegistry {
                  event CertificateRegistered(string cert);
                  constructor(address _user, string _cert) {
                    registerCert(_user, _cert);
                    emit CertificateRegistered(_cert);
                  }
                }
                |]
          contractName' = "CertRegistry"
          txMd' = M.fromList [("src", registry), ("name", contractName'), ("args", args')]
          mkRegistryTx = mkSignedTx (privKeys !! 0) (U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Nothing
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code $ BC.pack registry
            , U.unsignedTransactionChainId    = Nothing
            }) txMd'
        
          src = [r|
pragma solidvm 3.2;
contract A {
  event OrgUnitAdded(string name, string unit);

  constructor() {}

  function addOrg(string _name, string _unit) {
    emit OrgUnitAdded(_name, _unit);
  }
}
|]
          contractName = "A"
          chainInfo' = ChainInfo
            UnsignedChainInfo { chainLabel     = "My test chain!"
                              , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                 , NonContract (validators' !! 0) 1000000000000000000000
                                                 ]
                              , codeInfo       = [CodeInfo "" src $ Just contractName]
                              , members        = chainMember1
                              , parentChain    = Nothing
                              , creationBlock  = zeroHash
                              , chainNonce     = 123456789
                              , chainMetadata  = M.singleton "VM" "SolidVM"
                              }
            Nothing
          chainId = keccak256ToWord256 $ rlpHash chainInfo'
      ts <- liftIO getCurrentMicrotime
      let args = "(" <> "\"Blockapps\", \"engineering\")"
          utx' = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Just $ Address 0x100
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code ""
            , U.unsignedTransactionChainId    = Just $ ChainId chainId
            }
          tx' = mkSignedTx (privKeys !! 0) utx' txMd
          txMd = M.fromList [("funcName","addOrg"),("args",args)]
          ietx = IETx ts $ IngestTx Origin.API tx'
          routine = do
            threadDelay 500000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx mkRegistryTx
            threadDelay 500000
            flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (chainId, chainInfo')
            threadDelay 500000
            flip postEvent (peers !! 0) $ UnseqEvent ietx
            for_ peers $ postEvent (TimerFire 0)

      runForThreeSeconds $ concurrently_ (runNetworkOld peers connections') routine
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      ifor_ ctxs1 $ \i ctx -> (i, ctx ^. apiChainInfoMap . at chainId) `shouldBe` (i, if i == 2 then Nothing else Just chainInfo')

    it "can sync a new node to a chain after running multiple transactions on that chain" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..3]
      let validators' = makeValidators privKeys
      peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        , ("node3", "9.10.11.12")
        ]
      connections' <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        , (peers !! 0, peers !! 2)
        , (peers !! 1, peers !! 2)
        ]
      
      registryTs <- liftIO getCurrentMicrotime

      -- let toIetxRegistry = IETx registryTs . IngestTx Origin.API
                -- Create a certificate registry on the main chain
      let iss   = Issuer {  issCommonName = "Dustin"
                          , issOrg        = "Blockapps"
                          , issUnit       = Just "engineering"
                          , issCountry    = Just "USA"
                          }
          subj  = Subject { subCommonName = "Garrett"
                          , subOrg        = "Blockapps"
                          , subUnit       = Just "engineering"
                          , subCountry    = Just "USA"
                          , subPub        = derivePublicKey (privKeys !! 1)
                          }
      cert <- makeSignedCert Nothing (Just rootCert) iss subj
      let cert' = decodeUtf8 . certToBytes $ cert
          args' = "(0x" <> (T.pack $ (formatAddressWithoutColor . fromPrivateKey) (privKeys !! 0)) <> ", \"" <> cert' <> "\")"
          registry = [r|
pragma solidvm 3.0;
contract CertRegistry {
  event CertificateRegistered(string cert);
  
  constructor(address _user, string _cert) {
    registerCert(_user, _cert);
    emit CertificateRegistered(_cert);
  }
}
|]
          contractName' = "CertRegistry"
          txMd' = M.fromList [("src", registry), ("name", contractName'), ("args", args')]
          mkRegistryTx = mkSignedTx (privKeys !! 0) (U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Nothing
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code $ BC.pack registry
            , U.unsignedTransactionChainId    = Nothing
            }) txMd'
          src = [r|
pragma solidvm 3.2;
contract A {
  event CommonNameAdded(string name, string unit, string commonName);
  uint x = 0;

  constructor() {}

  function addMember(string _name, string _unit, string _commonName) {
    emit CommonNameAdded(_name, _unit, _commonName);
  }

  function incX() {
    x++;
  }

}|]
          contractName = "A"
--           mainChainSrc = [r|
-- pragma solidvm 3.2;
-- contract B {
--   uint y;

--   constructor() {
--     y = 47;
--   }
-- }
-- |]
          -- mainChainContractName = "B"
          chainMember1 = CM.ChainMembers $ Set.fromList  [(CM.CommonName (T.pack "Blockapps") (T.pack "engineering") (T.pack "David Nallapu") True)
                                                         ,(CM.CommonName (T.pack "Blockapps") (T.pack "engineering") (T.pack "Garrett") True)]
          chainMember2 = CM.ChainMembers $ Set.singleton (CM.CommonName (T.pack "Blockapps") (T.pack "engineering") (T.pack "David Nallapu") True)
          mkChainInfo bHash = ChainInfo
            UnsignedChainInfo { chainLabel     = "My parent test chain!"
                              , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                 , NonContract (validators' !! 0) 1000000000000000000000
                                                 , NonContract (validators' !! 1) 1000000000000000000000
                                                 ]
                              , codeInfo       = [CodeInfo "" src $ Just contractName]
                              , members        = chainMember1
                              , parentChain    = Nothing
                              , creationBlock  = bHash
                              , chainNonce     = 123456789
                              , chainMetadata  = M.singleton "VM" "SolidVM"
                              }
            Nothing
          mkChainInfo2 bHash pChain = ChainInfo
            UnsignedChainInfo { chainLabel     = "My child test chain!"
                              , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                 , NonContract (validators' !! 0) 1000000000000000000000
                                                 ]
                              , codeInfo       = [CodeInfo "" src $ Just contractName]
                              , members        = chainMember2
                              , parentChain    = Just pChain
                              , creationBlock  = bHash
                              , chainNonce     = 123456789
                              , chainMetadata  = M.singleton "VM" "SolidVM"
                              }
            Nothing
          mkChainId = keccak256ToWord256 . rlpHash
      ts <- liftIO getCurrentMicrotime
      let incXArgs = "()"
          incXUtx chainId = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Just $ Address 0x100
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code ""
            , U.unsignedTransactionChainId    = Just $ ChainId chainId
            }
          incXUtx0 chainId = (incXUtx chainId) 
          incXUtx1 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 1}
          incXUtx2 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 2}
          incXUtx3 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 3}
          incXUtx4 chainId = (incXUtx chainId){U.unsignedTransactionNonce = Nonce 4}
          txMd = M.fromList [("funcName","incX"),("args",incXArgs)]
          incXTx0 = flip (mkSignedTx (privKeys !! 0)) txMd . incXUtx0
          incXTx1 = flip (mkSignedTx (privKeys !! 0)) txMd . incXUtx1
          incXTx2 = flip (mkSignedTx (privKeys !! 0)) txMd . incXUtx2
          incXTx3 = flip (mkSignedTx (privKeys !! 0)) txMd . incXUtx3
          incXTx4 = flip (mkSignedTx (privKeys !! 0)) txMd . incXUtx4
      -- let mainChainArgs = "()"
      --     mainChainUtx = U.UnsignedTransaction
      --       { U.unsignedTransactionNonce      = Nonce 0
      --       , U.unsignedTransactionGasPrice   = Wei 1
      --       , U.unsignedTransactionGasLimit   = Gas 1000000000
      --       , U.unsignedTransactionTo         = Nothing
      --       , U.unsignedTransactionValue      = Wei 0
      --       , U.unsignedTransactionInitOrData = Code $ BC.pack mainChainSrc
      --       , U.unsignedTransactionChainId    = Nothing
      --       }
      --     mainChainTxMd = M.fromList [("src", mainChainSrc), ("name", mainChainContractName), ("args", mainChainArgs)]
      --     mkMainChainTx n = let utx = mainChainUtx{U.unsignedTransactionNonce = Nonce n}
      --                        in mkSignedTx (privKeys !! 0) utx mainChainTxMd
      cIdRef <- newIORef undefined
      cInfoRef <- newIORef undefined
      cId2Ref <- newIORef undefined
      cInfo2Ref <- newIORef undefined
      let addMemberArgs = "(" <> "\"Blockapps\", \"engineering\", \"Garrett\")"
          addMemberUtx chainId = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 5
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Just $ Address 0x100
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code ""
            , U.unsignedTransactionChainId    = Just $ ChainId chainId
            }
          addMemberTxMd = M.fromList [("funcName","addMember"),("args",addMemberArgs)]
          addMemberTx cId = mkSignedTx (privKeys !! 0) (addMemberUtx cId) addMemberTxMd
      let toIetx = IETx ts . IngestTx Origin.API
      -- let mainChainRoutine n = do
      --       threadDelay 200000
      --       flip postEvent (peers !! 0) . UnseqEvent . toIetx $ mkMainChainTx n
      --       mainChainRoutine $ n + 1
      let routine = do
            threadDelay 2000000
            for_ peers $ postEvent (TimerFire 0)
            threadDelay 2000000
            flip postEvent (peers !! 0) . UnseqEvent $ IETx registryTs $ IngestTx Origin.API mkRegistryTx
            bHash <- fmap (bestBlockHash . _bestBlock) . readTVarIO . _p2pTestContext $ peers !! 0
            let cInfo = mkChainInfo bHash
                cId = mkChainId cInfo
            writeIORef cIdRef cId
            writeIORef cInfoRef cInfo
            flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (cId, cInfo)
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx0 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx1 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx2 cId
            bHash2 <- fmap (bestBlockHash . _bestBlock) . readTVarIO . _p2pTestContext $ peers !! 0
            let cInfo2 = mkChainInfo2 bHash2 cId
                cId2 = mkChainId cInfo2
            writeIORef cId2Ref cId2
            writeIORef cInfo2Ref cInfo2
            flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (cId2, cInfo2)
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx3 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx0 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx1 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx2 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx4 cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx3 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ incXTx4 cId2
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ addMemberTx cId
            threadDelay 5000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ addMemberTx cId2
          
      void . timeout 80000000 $ concurrently_ (runNetworkOld peers connections') routine
      cId <- readIORef cIdRef
      cInfo <- readIORef cInfoRef
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      for_ ctxs1 $ \ctx -> (ctx ^. x509certMap) `shouldNotBe` M.empty
      ifor_ ctxs1 $ \i ctx -> (i, ctx ^. apiChainInfoMap . at cId) `shouldBe` (i, if i == 2 then Nothing else Just cInfo)
      cId2 <- readIORef cId2Ref
      cInfo2 <- readIORef cInfo2Ref
      ifor_ ctxs1 $ \i ctx -> (i, ctx ^. apiChainInfoMap . at cId2) `shouldBe` (i, if i == 2 then Nothing else Just cInfo2)
      --privKey4 <- newPrivateKey
      --peer4 <- createPeer' privKey4 validators' "node4" "13.14.15.16"
      --let peers' = peers ++ [peer4]
      --connections4 <- traverse (uncurry createConnection)
      --  [ (peers' !! 0, peers' !! 3)
      --  , (peers' !! 1, peers' !! 3)
      --  , (peers' !! 2, peers' !! 3)
      --  ]
      --let connections' = connections ++ connections4

    it "can register and unregister a cert on the main chain" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..2]
      let globalAdmin = privKeys !! 0
          orgAdmin = privKeys !! 1
          validators' = makeValidators privKeys
      peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip privKeys
        [ ("node1", "1.2.3.4")
        , ("node2", "5.6.7.8")
        ]
      connections' <- traverse (uncurry createConnection)
        [ (peers !! 0, peers !! 1)
        ]
      let src = [r|
pragma solidvm 3.0;

contract RegisterCert {
  event CertificateRegistered(string cert);

  constructor(address _user, string _cert) {
    registerCert(_user, _cert);
    emit CertificateRegistered(_cert);
  }
}
|]
          contractName = "RegisterCert"
      ts <- liftIO getCurrentMicrotime
      let testCert1 = "-----BEGIN CERTIFICATE-----\nMIIB0jCCAXegAwIBAgIQeEdWygiiwHQ9e5bfkQVdVTAMBggqhkjOPQQDAgUAMGsx\nEjAQBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYy\nMzg4NzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAK\nBgNVBAYMA1VTQTAeFw0yMTEwMTkxNTE2MzZaFw0yMjEwMTkxNTE2MzZaMGsxEjAQ\nBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYyMzg4\nNzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAKBgNV\nBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLsHOfw6jXFjQRAoLVDLwsmr\nKtHn5O6Cisa47lzxV0NfXVJXCcVP2N95GAB5/pmLsmE8rcdLQVBQFLWPjhGoCQ4w\nDAYIKoZIzj0EAwIFAANHADBEAiAChH6dQTLS/F/lNt7JkjMpC0uo6MEFI+zV5hCB\noNnc1gIgaMpLif4qKPRfAFjQJCJR8ORV1PEXf9xBK7XtPONqDQ0=\n-----END CERTIFICATE-----"
          emptyCert = "-----BEGIN CERTIFICATE-----\nMIIBVDCB+aADAgECAhBPjHUswOXtDsbDeQIsdepkMAwGCCqGSM49BAMCBQAwLDEJ\nMAcGA1UEAwwAMQkwBwYDVQQKDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMB4XDTIx\nMDUyNTE1MzQxNVoXDTIyMDUyNTE1MzQxNVowLDEJMAcGA1UEAwwAMQkwBwYDVQQK\nDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAE\n4X1p4KE8cB6vYqKzSHIl+V5fDUC9p0j8OfOQOUhCfkjG1ALuRyP68tTohz9TLPLk\nYCVKrCiueuZJbejnGsp21TAMBggqhkjOPQQDAgUAA0gAMEUCIQCVtizg/N3MBdLi\nfHto7tqu1ia6cZpMI/G2bLWSPErK9AIgcBw+S8iVqSjh61CkgBAS066Z7M/W9eeY\n+sm9OKHDfQQ=\n-----END CERTIFICATE-----"
          args addr cert = "(0x" <> T.pack (formatAddressWithoutColor addr) <> ", \"" <> cert <> "\")"
          utx = U.UnsignedTransaction
            { U.unsignedTransactionNonce      = Nonce 0
            , U.unsignedTransactionGasPrice   = Wei 1
            , U.unsignedTransactionGasLimit   = Gas 1000000000
            , U.unsignedTransactionTo         = Nothing
            , U.unsignedTransactionValue      = Wei 0
            , U.unsignedTransactionInitOrData = Code $ BC.pack src
            , U.unsignedTransactionChainId    = Nothing
            }
          txMd addr cert = M.fromList [("src", src), ("name", contractName), ("args", args addr cert)]
          mkTx pSigner pCert n =
            let utx' = utx{U.unsignedTransactionNonce = Nonce n}
                addr = fromPrivateKey pCert
             in mkSignedTx pSigner utx' $ txMd addr testCert1
          mkEmptyTx pSigner pCert n =
            let utx' = utx{U.unsignedTransactionNonce = Nonce n}
                addr = fromPrivateKey pCert
             in mkSignedTx pSigner utx' $ txMd addr emptyCert
          toIetx = IETx ts . IngestTx Origin.API
          routine = do
            threadDelay 200000
            for_ peers $ postEvent (TimerFire 0)
            threadDelay 200000
            for_ peers $ postEvent (TimerFire 1)
            threadDelay 200000
            let tx1 = mkTx globalAdmin orgAdmin 0
                tx2 = mkEmptyTx orgAdmin orgAdmin 0
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx tx1
            threadDelay 1000000
            flip postEvent (peers !! 0) . UnseqEvent $ toIetx tx2
      void . timeout 3000000 $ concurrently_ (runNetworkOld peers connections') routine
      ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
      for_ ctxs1 $ \ctx -> (ctx ^. x509certMap) `shouldNotBe` M.empty

  describe "X.509 Private Chain exchange" $ do
    it "can add an organization to a private chain" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer)..3]
        let validators' = makeValidators privKeys
        peers <- traverse (\(p,(n,i)) -> createPeer' p validators' n i) $ zip privKeys
          [ ("node1", "1.2.3.4")
          , ("node2", "5.6.7.8")
          , ("node3", "9.10.11.12")
          ]
        connections' <- traverse (uncurry createConnection)
          [ (peers !! 0, peers !! 1)
          , (peers !! 0, peers !! 2)
          , (peers !! 1, peers !! 2)
          ]
        ts <- liftIO getCurrentMicrotime
        cIdRef <- newIORef undefined
        cInfoRef <- newIORef undefined
        let runForThreeSeconds = void . timeout 5000000
            toIetx = IETx ts . IngestTx Origin.API
            mkChainId = keccak256ToWord256 . rlpHash

        -- Create a certificate registry on the main chain
            iss   = Issuer {  issCommonName = "Dustin"
                            , issOrg        = "Blockapps"
                            , issUnit       = Just "engineering"
                            , issCountry    = Just "USA"
                            }
            subj  = Subject { subCommonName = "Garrett"
                            , subOrg        = "Blockapps"
                            , subUnit       = Just "engineering"
                            , subCountry    = Just "USA"
                            , subPub        = derivePublicKey (privKeys !! 1)
                            } 
        cert <- makeSignedCert Nothing (Just rootCert) iss subj
        let cert' = decodeUtf8 . certToBytes $ cert
            args' = "(0x" <> (T.pack $ (formatAddressWithoutColor . fromPrivateKey) (privKeys !! 0)) <> ", \"" <> cert' <>"\")"
            registry = [r|
                  pragma solidvm 3.0;
                  contract CertRegistry {
                    event CertificateRegistered(string cert);

                    constructor(address _user, string _cert) {
                      registerCert(_user, _cert);
                      emit CertificateRegistered(_cert);
                    }
                  }
                  |]
            contractName' = "CertRegistry"
            txMd' = M.fromList [("src", registry), ("name", contractName'), ("args", args')]
            mkRegistryTx = mkSignedTx (privKeys !! 0) (U.UnsignedTransaction
              { U.unsignedTransactionNonce      = Nonce 0
              , U.unsignedTransactionGasPrice   = Wei 1
              , U.unsignedTransactionGasLimit   = Gas 1000000000
              , U.unsignedTransactionTo         = Nothing
              , U.unsignedTransactionValue      = Wei 0
              , U.unsignedTransactionInitOrData = Code $ BC.pack registry
              , U.unsignedTransactionChainId    = Nothing
              }) txMd'

            -- Post a mock dApp to a private chain
            src = [r|
                  pragma solidvm 3.2;
                  contract A {
                    event OrgAdded(string name);

                    constructor() {}

                    function addOrg(string _name) {
                      emit OrgAdded(_name);
                    }
                  }
                  |]
            contractName = "A"
            chainMember1 = (CM.ChainMembers $ Set.singleton $ CM.CommonName (T.pack "BlockApps") (T.pack "engineering") (T.pack "Dustin") True)
            args = "(" <> "\"Blockapps\")"
            txMd = M.fromList [("funcName", "addOrg"), ("args", args)]
            tChainInfo = ChainInfo
              UnsignedChainInfo { chainLabel     = "My organization's private chain"
                                , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                  , NonContract (validators' !! 0) 1000000000000000000000
                                                  , NonContract (validators' !! 1) 1000000000000000000000
                                                  ]
                                , codeInfo       = [CodeInfo "" src $ Just contractName]
                                , members        = chainMember1
                                , parentChain    = Nothing
                                , creationBlock  = zeroHash
                                , chainNonce     = 123456789
                                , chainMetadata  = M.singleton "VM" "SolidVM"
                                }
              Nothing
            setupTx cId = U.UnsignedTransaction
              { U.unsignedTransactionNonce      = Nonce 0
              , U.unsignedTransactionGasPrice   = Wei 1
              , U.unsignedTransactionGasLimit   = Gas 1000000000
              , U.unsignedTransactionTo         = Just $ Address 0x100
              , U.unsignedTransactionValue      = Wei 0
              , U.unsignedTransactionInitOrData = Code ""
              , U.unsignedTransactionChainId    = Just $ ChainId cId
              }
            signedPrivTx tx = mkSignedTx (privKeys !! 0) (setupTx tx) txMd

            routine = do
              threadDelay 200000
              for_ peers $ postEvent (TimerFire 0)
              threadDelay 200000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx mkRegistryTx    -- Post cert registry contract to the main chain
              threadDelay 200000
              let cInfo = tChainInfo
                  cId = mkChainId cInfo
              writeIORef cIdRef cId
              writeIORef cInfoRef cInfo
              flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (cId, cInfo)  -- Post private chain
              threadDelay 200000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ signedPrivTx cId -- Add organization to private chain

        runForThreeSeconds $ concurrently_ (runNetworkOld peers connections') routine
        ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
        testCid <- readIORef cIdRef

        -- Cert should be inserted into every node
        for_ ctxs1 $ \ctx -> (ctx ^. x509certMap) `shouldNotBe` M.empty

        -- Node 1's cert was registered in the contract so it should receive the chain ID
        (ctxs1 !! 1) ^. trueOrgNameChainsMap `shouldBe`
          M.singleton (CM.ChainMembers $ Set.singleton $ CM.Org (T.pack "Blockapps") True) (CM.TrueOrgNameChains $ Set.singleton testCid)

        -- Node 2's cert is not registered so it should not have any in the set
        (ctxs1 !! 2) ^. trueOrgNameChainsMap `shouldBe` M.empty

        -- TODO: milliseconds to seconds => threadDelayInSeconds :: Seconds -> IO ()
