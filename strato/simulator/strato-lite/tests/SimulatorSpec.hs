{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module SimulatorSpec where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.Messages (round)
import Blockchain.Blockstanbul.StateMachine
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.Data.AddressStateDB
import qualified Blockchain.Data.AlternateTransaction as U
import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.Block hiding (bestBlockNumber)
import qualified Blockchain.Data.Block as Block (bestBlockNumber)
import Blockchain.Data.BlockDB ()
import Blockchain.Data.ChainInfo
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Data.TransactionDef
import Blockchain.EthEncryptionException (EthEncryptionException (..))
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ChainMember
import qualified Blockchain.Strato.Model.ChainMember as CM
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.MicroTime
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Wei
import qualified Blockchain.VMContext as VMC
import Conduit
import Control.Concurrent.STM.TMChan
import Control.Lens hiding (Context, view)
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Reader
import qualified Data.ByteString.Char8 as BC
import Data.Foldable (for_)
import qualified Data.Map.Strict as M
import qualified Data.Set as Set
import qualified Data.Text as T
import Data.Text.Encoding
import Data.Traversable (for)
import SolidVM.Model.Storable
import Strato.Lite
import Test.Hspec
import Test.QuickCheck
import Text.RawString.QQ
import UnliftIO
import UnliftIO.Concurrent (threadDelay)
import Prelude hiding (round)

instance Eq SomeException where
  _ == _ = True -- for the purpose of my test, all exceptions are equal

spec :: Spec
spec = do
  describe "network simulation" $ do
    it "should send a transaction from server to client" $ do
        serverPKey <- newPrivateKey
        clientPKey <- newPrivateKey
        let validatorAddresses = fromPrivateKey <$> [serverPKey, clientPKey]
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True
              ]
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip [serverPKey, clientPKey] validatorInfos
        server' <- createPeer' serverPKey (validatorInfos !! 0) zippedValidators certs "server" "1.2.3.4"
        client' <- createPeer' clientPKey (validatorInfos !! 1) zippedValidators certs "client" "5.6.7.8"
        connection <- createConnection server' client'
        let clearChainId tx = case tx of
              MessageTX {} -> tx {transactionChainId = Nothing}
              ContractCreationTX {} -> tx {transactionChainId = Nothing}
              PrivateHashTX {} -> tx
        otx <- (\o -> o {otBaseTx = clearChainId (otBaseTx o), otOrigin = Origin.API}) <$> liftIO (generate arbitrary)
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
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 7]
        let identities =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True,
                CommonName "Apple" "Hardware" "Tim Apple" True,
                CommonName "Netflix" "Casting" "Block Buster" True,
                CommonName "Meta" "Metaverse" "Zark Muckerberg" True,
                CommonName "Google" "Search" "Larry PageRank" True
              ]
            validatorsPrivKeys' = privKeys
            validatorAddresses = fromPrivateKey <$> validatorsPrivKeys'
            validatorInfos = identities
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys identities
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys identities)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12"),
                ("node4", "13.14.15.16"),
                ("node5", "17.18.19.20"),
                ("node6", "21.22.23.24"),
                ("node7", "25.26.27.28")
              ]
        let validators' = peers
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 0, peers !! 3),
                            (peers !! 0, peers !! 4),
                            (peers !! 0, peers !! 5),
                            (peers !! 0, peers !! 6),
                            (peers !! 1, peers !! 2),
                            (peers !! 1, peers !! 3),
                            (peers !! 1, peers !! 4),
                            (peers !! 1, peers !! 5)
                          ]
        let runForTwoSeconds = void . timeout 2000000
            postTimeoutEvent = do
              threadDelay 1000000
              for_ validators' $ postEvent (TimerFire 0)
        runForTwoSeconds $ concurrently_ (runNetworkOld peers connections') postTimeoutEvent
        ctxs <- atomically $ traverse (readTVar . _p2pTestContext) peers
        ifor_ ctxs $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1 :: Maybe Word256)

    it "should update the round number after failing on a divided network first" $ do
      privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 3]
      let validatorsPrivKeys' = privKeys
          primaryValidatorsPrivKeys = [head validatorsPrivKeys']
          primaryValidatorAddresses = fromPrivateKey <$> primaryValidatorsPrivKeys
          validatorInfos =
            [ CommonName "BlockApps" "Engineering" "Admin" True,
              CommonName "Microsoft" "Sales" "Person" True,
              CommonName "Amazon" "Product" "Jeff Bezos" True
            ]
          primaryValidatorInfos = [head validatorInfos]
          primaryValidators' = zip primaryValidatorAddresses primaryValidatorInfos
          zippedValidators = makeValidators $ zip validatorsPrivKeys' validatorInfos
      certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
      peers <-
        traverse (\((p, c), (n, i)) -> createPeer' p c primaryValidators' certs n i) $
          zip
            (zip privKeys validatorInfos)
            [ ("node1", "1.2.3.4"),
              ("node2", "5.6.7.8"),
              ("node3", "9.10.11.12")
            ]
      let validators' = peers
          primaryValidators = [head validators']
          secondaryValidators = tail validators'
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
      do
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2)
                          ]
        atomically $
          modifyTVar'
            ((peers !! 1) ^. p2pTestContext)
            ( (sequencerContext . blockstanbulContext . _Just . validators .~ ChainMembers (Set.fromList validatorInfos))
                . (sequencerContext . blockstanbulContext . _Just . view . round .~ 1000)
                . (sequencerContext . x509certInfoState %~ addValidatorsToCertMap zippedValidators)
            )
        atomically $
          modifyTVar'
            ((peers !! 2) ^. p2pTestContext)
            ( (sequencerContext . blockstanbulContext . _Just . validators .~ ChainMembers (Set.fromList validatorInfos))
                . (sequencerContext . blockstanbulContext . _Just . view . round .~ 1000)
                . (sequencerContext . x509certInfoState %~ addValidatorsToCertMap zippedValidators)
            )
        runForTwoSeconds $ concurrently_ (runNetworkOld peers connections') (concurrently_ postTimeoutPrimary1 postTimeoutSecondary)
        ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
        ifor_ ctxs1 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, if i == 0 then Just (1 :: Word256) else Just 1000)
      do
        connections'' <- traverse
                           (\(a,b) -> createConnection a b)
                           [ (peers !! 0, peers !! 1),
                             (peers !! 0, peers !! 2),
                             (peers !! 1, peers !! 2)
                           ]

        atomically $
          modifyTVar'
            ((peers !! 0) ^. p2pTestContext)
            ( (sequencerContext . blockstanbulContext . _Just . validators .~ ChainMembers (Set.fromList validatorInfos))
                . (sequencerContext . x509certInfoState %~ addValidatorsToCertMap zippedValidators)
                . (p2pValidators .~ Set.fromList validatorInfos)
            )
        runForTwoSeconds $ concurrently_ (runNetworkOld peers connections'') (concurrently_ postTimeoutPrimary2 postTimeoutSecondary)
        ctxs2 <- atomically $ traverse (readTVar . _p2pTestContext) peers
        ifor_ ctxs2 $ \i ctx -> (i, _round . _view <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1001 :: Maybe Word256)

    it "can add a new node to a chain" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 3]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True
              ]
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2)
                          ]
  
        registryTs <- liftIO getCurrentMicrotime
  
        let runForSeconds n = void . timeout (n * 1000000)
            toIetx = IETx registryTs . IngestTx Origin.API
            chainMember1 = ChainMembers $ Set.singleton $ (Org (T.pack "BlockApps") True)
            -- Create a certificate registry on the main chain
            iss =
              Issuer
                { issCommonName = "David Nallapu",
                  issOrg = "Blockapps",
                  issUnit = Just "engineering",
                  issCountry = Just "USA"
                }
            subj =
              Subject
                { subCommonName = "Garrett",
                  subOrg = "Blockapps",
                  subUnit = Just "engineering",
                  subCountry = Just "USA",
                  subPub = derivePublicKey (privKeys !! 1)
                }
        cert <- makeSignedCert Nothing (Just rootCert) iss subj
        let cert' = decodeUtf8 . certToBytes $ cert
            args' = "(0x" <> (T.pack $ (formatAddressWithoutColor . fromPrivateKey) (privKeys !! 0)) <> ", \"" <> cert' <> "\")"
            registry =
              [r|
                  contract CertRegistry {
                    event CertificateRegistered(string cert);
                    constructor(address _user, string _cert) {
                      emit CertificateRegistered(_cert);
                    }
                  }
                  |]
            contractName' = "CertRegistry"
            txMd' = M.fromList [("src", registry), ("name", contractName'), ("args", args')]
            mkRegistryTx =
              mkSignedTx
                (privKeys !! 0)
                ( U.UnsignedTransaction
                    { U.unsignedTransactionNonce = Nonce 0,
                      U.unsignedTransactionGasPrice = Wei 1,
                      U.unsignedTransactionGasLimit = Gas 1000000000,
                      U.unsignedTransactionTo = Nothing,
                      U.unsignedTransactionValue = Wei 0,
                      U.unsignedTransactionInitOrData = Code $ BC.pack registry,
                      U.unsignedTransactionChainId = Nothing
                    }
                )
                txMd'
  
            src =
              [r|
  contract A {
    event OrgAdded(string name);
  
    constructor() {}
  
    function addOrg(string _name) {
      emit OrgAdded(_name);
    }
  }
  |]
            contractName = "A"
            chainInfo' =
              signChain (privKeys !! 0) $
                UnsignedChainInfo
                  { chainLabel = "My test chain!",
                    accountInfo =
                      [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src),
                        NonContract (validatorAddresses !! 0) 1000000000000000000000
                      ],
                    codeInfo = [CodeInfo "" src $ Just contractName],
                    members = chainMember1,
                    parentChains = M.empty,
                    creationBlock = zeroHash,
                    chainNonce = 123456789,
                    chainMetadata = M.singleton "VM" "SolidVM"
                  }
            chainId = keccak256ToWord256 $ rlpHash chainInfo'
        ts <- liftIO getCurrentMicrotime
        let args = "(\"Microsoft\")"
            utx' =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Just $ ChainId chainId
                }
            tx' = mkSignedTx (privKeys !! 0) utx' txMd
            txMd = M.fromList [("funcName", "addOrg"), ("args", args)]
            ietx = IETx ts $ IngestTx Origin.API tx'
            routine = do
              threadDelay 500000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx mkRegistryTx
              threadDelay 500000
              flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (chainId, chainInfo')
              threadDelay 500000
              flip postEvent (peers !! 0) $ UnseqEvent ietx
              for_ peers $ postEvent (TimerFire 0)
  
        runForSeconds 15 $ concurrently_ (runNetworkOld peers connections') routine
        ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
        ifor_ ctxs1 $ \i ctx -> (i, ctx ^. apiChainInfoMap . at chainId) `shouldBe` (i, if i == 2 then Nothing else Just chainInfo')
    it "can sync a new node to a chain after running multiple transactions on that chain" $ do
        -- TODO: somehow this test got reverted to a previous faulty state
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 3]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True
              ]
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2)
                          ]
  
        let src =
              [r|
  contract A {
    event OrgAdded(string name);
    uint x = 0;
  
    constructor() {}
  
    function addMember(string _name) {
      emit OrgAdded(_name);
    }
  
    function incX() {
      x++;
    }
  
  }|]
            contractName = "A"
            --           mainChainSrc = [r|
            -- contract B {
            --   uint y;
  
            --   constructor() {
            --     y = 47;
            --   }
            -- }
            -- ]
            --  mainChainContractName = "B"
            chainMember1 =
              CM.ChainMembers $
                Set.fromList
                  [ (CM.CommonName (T.pack "Blockapps") (T.pack "engineering") (T.pack "David Nallapu") True),
                    (CM.CommonName (T.pack "Blockapps") (T.pack "engineering") (T.pack "Garrett") True)
                  ]
            chainMember2 = CM.ChainMembers $ Set.singleton (CM.CommonName (T.pack "Blockapps") (T.pack "engineering") (T.pack "David Nallapu") True)
            mkChainInfo bHash =
              signChain (privKeys !! 0) $
                UnsignedChainInfo
                  { chainLabel = "My parent test chain!",
                    accountInfo =
                      [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src),
                        NonContract (validatorAddresses !! 0) 1000000000000000000000,
                        NonContract (validatorAddresses !! 1) 1000000000000000000000
                      ],
                    codeInfo = [CodeInfo "" src $ Just contractName],
                    members = chainMember1,
                    parentChains = M.empty,
                    creationBlock = bHash,
                    chainNonce = 123456789,
                    chainMetadata = M.singleton "VM" "SolidVM"
                  }
            mkChainInfo2 bHash pChain =
              signChain (privKeys !! 0) $
                UnsignedChainInfo
                  { chainLabel = "My child test chain!",
                    accountInfo =
                      [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src),
                        NonContract (validatorAddresses !! 0) 1000000000000000000000
                      ],
                    codeInfo = [CodeInfo "" src $ Just contractName],
                    members = chainMember2,
                    parentChains = M.singleton "parent" pChain,
                    creationBlock = bHash,
                    chainNonce = 123456789,
                    chainMetadata = M.singleton "VM" "SolidVM"
                  }
            mkChainId = keccak256ToWord256 . rlpHash
        ts <- liftIO getCurrentMicrotime
        let incXArgs = "()"
            incXUtx chainId =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Just $ ChainId chainId
                }
            incXUtx0 chainId = (incXUtx chainId)
            incXUtx1 chainId = (incXUtx chainId) {U.unsignedTransactionNonce = Nonce 1}
            incXUtx2 chainId = (incXUtx chainId) {U.unsignedTransactionNonce = Nonce 2}
            incXUtx3 chainId = (incXUtx chainId) {U.unsignedTransactionNonce = Nonce 3}
            incXUtx4 chainId = (incXUtx chainId) {U.unsignedTransactionNonce = Nonce 4}
            txMd = M.fromList [("funcName", "incX"), ("args", incXArgs)]
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
        let addMemberArgs = "(\"Microsoft\")"
            addMemberUtx chainId =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 5,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Just $ ChainId chainId
                }
            addMemberTxMd = M.fromList [("funcName", "addMember"), ("args", addMemberArgs)]
            addMemberTx cId = mkSignedTx (privKeys !! 0) (addMemberUtx cId) addMemberTxMd
        let toIetx = IETx ts . IngestTx Origin.API
        -- let mainChainRoutine n = do
        --       threadDelay 200000
        --       flip postEvent (peers !! 0) . UnseqEvent . toIetx $ mkMainChainTx n
        --       mainChainRoutine $ n + 1
        let routine = do
              threadDelay 2000000
              for_ peers $ postEvent (TimerFire 0)
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
  
        void . timeout 100000000 $ concurrently_ (runNetworkOld peers connections') routine
        cId <- readIORef cIdRef
        cInfo <- readIORef cInfoRef
        ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
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
        -- TODO: use registry at 0x509
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 2]
        let globalAdmin = privKeys !! 0
            orgAdmin = privKeys !! 1
            validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True
              ]
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1)
                          ]
        let src =
              [r|
  
  contract RegisterCert {
    event CertificateRegistered(string cert);
  
    constructor(address _user, string _cert) {
      emit CertificateRegistered(_cert);
    }
  }
  |]
            contractName = "RegisterCert"
        ts <- liftIO getCurrentMicrotime
        let testCert1 = "-----BEGIN CERTIFICATE-----\nMIIB0jCCAXegAwIBAgIQeEdWygiiwHQ9e5bfkQVdVTAMBggqhkjOPQQDAgUAMGsx\nEjAQBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYy\nMzg4NzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAK\nBgNVBAYMA1VTQTAeFw0yMTEwMTkxNTE2MzZaFw0yMjEwMTkxNTE2MzZaMGsxEjAQ\nBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYyMzg4\nNzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAKBgNV\nBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLsHOfw6jXFjQRAoLVDLwsmr\nKtHn5O6Cisa47lzxV0NfXVJXCcVP2N95GAB5/pmLsmE8rcdLQVBQFLWPjhGoCQ4w\nDAYIKoZIzj0EAwIFAANHADBEAiAChH6dQTLS/F/lNt7JkjMpC0uo6MEFI+zV5hCB\noNnc1gIgaMpLif4qKPRfAFjQJCJR8ORV1PEXf9xBK7XtPONqDQ0=\n-----END CERTIFICATE-----"
            emptyCert = "-----BEGIN CERTIFICATE-----\nMIIBVDCB+aADAgECAhBPjHUswOXtDsbDeQIsdepkMAwGCCqGSM49BAMCBQAwLDEJ\nMAcGA1UEAwwAMQkwBwYDVQQKDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMB4XDTIx\nMDUyNTE1MzQxNVoXDTIyMDUyNTE1MzQxNVowLDEJMAcGA1UEAwwAMQkwBwYDVQQK\nDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAE\n4X1p4KE8cB6vYqKzSHIl+V5fDUC9p0j8OfOQOUhCfkjG1ALuRyP68tTohz9TLPLk\nYCVKrCiueuZJbejnGsp21TAMBggqhkjOPQQDAgUAA0gAMEUCIQCVtizg/N3MBdLi\nfHto7tqu1ia6cZpMI/G2bLWSPErK9AIgcBw+S8iVqSjh61CkgBAS066Z7M/W9eeY\n+sm9OKHDfQQ=\n-----END CERTIFICATE-----"
            args addr cert = "(0x" <> T.pack (formatAddressWithoutColor addr) <> ", \"" <> cert <> "\")"
            utx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Nothing,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code $ BC.pack src,
                  U.unsignedTransactionChainId = Nothing
                }
            txMd addr cert = M.fromList [("src", src), ("name", contractName), ("args", args addr cert)]
            mkTx pSigner pCert n =
              let utx' = utx {U.unsignedTransactionNonce = Nonce n}
                  addr = fromPrivateKey pCert
               in mkSignedTx pSigner utx' $ txMd addr testCert1
            mkEmptyTx pSigner pCert n =
              let utx' = utx {U.unsignedTransactionNonce = Nonce n}
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
        void . timeout 5000000 $ concurrently_ (runNetworkOld peers connections') routine
        ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
        for_ ctxs1 $ \ctx -> (ctx ^. x509certMap) `shouldNotBe` M.empty

    it "can add vote in a new validator" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 3]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True
              ]
            zippedValidators = take 1 $ zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2)
                          ]
        ts <- liftIO getCurrentMicrotime
        let toIetx = IETx ts . IngestTx Origin.API
            args = "(\"Microsoft\",\"Sales\",\"Person\")"
            txMd = M.fromList [("funcName", "voteToAddValidator"), ("args", args)]
            setupTx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Nothing
                }
            signedTx = mkSignedTx (privKeys !! 0) setupTx txMd

            routine = do
              threadDelay 200000
              for_ peers $ postEvent (TimerFire 0)
              threadDelay 200000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx signedTx

        void . timeout 5000000 $ concurrently_ (runNetworkOld peers connections') routine
        ctxs <- atomically $ traverse (readTVar . _p2pTestContext) peers
        ifor_ ctxs $ \i ctx -> (i, Set.size . unChainMembers . _validators <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 2)

    it "can add and remove vote in a new validator" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 3]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True
              ]
            zippedValidators = take 1 $ zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2)
                          ]
        ts <- liftIO getCurrentMicrotime
        let toIetx = IETx ts . IngestTx Origin.API
            args = "(\"Microsoft\",\"Sales\",\"Person\")"
            addTxMd = M.fromList [("funcName", "voteToAddValidator"), ("args", args)]
            addTx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Nothing
                }
            signedAddTx = mkSignedTx (privKeys !! 0) addTx addTxMd
            removeTxMd = M.fromList [("funcName", "voteToRemoveValidator"), ("args", args)]
            removeTx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 1,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Nothing
                }
            signedRemoveTx = mkSignedTx (privKeys !! 0) removeTx removeTxMd

            routine1 = do
              threadDelay 200000
              for_ peers $ postEvent (TimerFire 0)
              threadDelay 200000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx signedAddTx
              threadDelay 5000000
              ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
              ifor_ ctxs1 $ \i ctx -> (i, Set.size . unChainMembers . _validators <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 2)
              threadDelay 200000
              postEvent (TimerFire 1) (peers !! 0)
              threadDelay 200000
              postEvent (TimerFire 2) (peers !! 0)
              threadDelay 200000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx signedRemoveTx

        void . timeout 10000000 $ concurrently_ (runNetworkOld peers connections') routine1
        ctxs2 <- atomically $ traverse (readTVar . _p2pTestContext) peers
        ifor_ ctxs2 $ \i ctx -> (i, Set.size . unChainMembers . _validators <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 1)

    it "can sync a new node after voting in a new validator" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 4]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True,
                CommonName "Facebook" "Executive" "Mark Zuckerberg" True
              ]
            zippedValidators = take 2 $ zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12"),
                ("node4", "13.14.15.16")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2),
                            (peers !! 0, peers !! 3),
                            (peers !! 1, peers !! 3),
                            (peers !! 2, peers !! 3)
                          ]
        ts <- liftIO getCurrentMicrotime
        let toIetx = IETx ts . IngestTx Origin.API
            args = "(\"Amazon\",\"Product\",\"Jeff Bezos\")"
            txMd = M.fromList [("funcName", "voteToAddValidator"), ("args", args)]
            setupTx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Nothing
                }
            signedTx = mkSignedTx (privKeys !! 0) setupTx txMd
            mainChainSrc =
              [r|
  contract B {
    uint y;
  
    constructor() {
      y = 47;
    }
  }
  |]
            mainChainContractName = "B"
            mainChainArgs = "()"
            mainChainUtx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Nothing,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code $ BC.pack mainChainSrc,
                  U.unsignedTransactionChainId = Nothing
                }
            mainChainTxMd = M.fromList [("src", mainChainSrc), ("name", mainChainContractName), ("args", mainChainArgs)]
            mkMainChainTx n =
              let utx = mainChainUtx {U.unsignedTransactionNonce = Nonce n}
               in mkSignedTx (privKeys !! 1) utx mainChainTxMd
            mainChainRoutine n = do
              threadDelay 200000
              flip postEvent (peers !! 1) . UnseqEvent . toIetx $ mkMainChainTx n
              mainChainRoutine $ n + 1
            routine = do
              threadDelay 200000
              for_ peers $ postEvent (TimerFire 0)
              threadDelay 1000000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx signedTx
              threadDelay 10000000
              runNetworkOld (drop 3 peers) (drop 3 connections')
  
        void . timeout 20000000 $ concurrently_ (runNetworkOld (take 3 peers) (take 3 connections')) (concurrently_ (void . timeout 4000000 $ mainChainRoutine 0) routine)
        ctxs <- atomically $ traverse (readTVar . _p2pTestContext) peers
        ifor_ ctxs $ \i ctx -> (i, Set.size . unChainMembers . _validators <$> _blockstanbulContext (_sequencerContext ctx)) `shouldBe` (i, Just 3)
    it "will throw an exception if the handshake times out" $ do
        serverPKey <- newPrivateKey
        clientPKey <- newPrivateKey
        let validatorAddresses = fromPrivateKey <$> [serverPKey, clientPKey]
            validatorInfos =
              [ CommonName "GrumpyCat, Inc" "" "GrumpyCat" True,
                CommonName "BlockApps" "" "Aya" True
              ]
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip [serverPKey, clientPKey] validatorInfos
        server' <- createPeer' serverPKey (validatorInfos !! 0) zippedValidators certs "server" "1.1.1.1"
        client' <- createPeer' clientPKey (validatorInfos !! 1) zippedValidators certs "client" "2.2.2.2"
        connection <- createGermophobicConnection server' client'
        void . timeout (3 * 1000 * 1000) $ runConnection connection
        clientExcept <- readTVarIO $ connection ^. clientException
        clientExcept `shouldBe` Just (toException $ HandshakeException "handshake timed out")
    it "will not get a stateroot mismatch if an exception occurs in the bagger" $ do
        privKey <- newPrivateKey
        let validatorAddress = fromPrivateKey privKey
            validatorInfo = CommonName "BlockApps" "Engineering" "Admin" True
        cert <- selfSignCert privKey validatorInfo 
        validator <- createPeer' privKey validatorInfo [(validatorAddress, validatorInfo)] [cert] "node1" "1.1.1.1"
        ts <- liftIO getCurrentMicrotime
        let toIetx = IETx ts . IngestTx Origin.API
            args = "(\"123\")" --dummy address
            txMd = M.fromList [("funcName", "getUserCert"), ("args", args)]
            tx n =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce n,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x509,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Nothing
                }
            signedTx n = mkSignedTx privKey (tx n) txMd

            reachNonceLim = do
              for [0..10] (\n -> flip postEvent validator . UnseqEvent . toIetx $ signedTx n) --nonce limit is 10; will trigger

        void . timeout 10000000 $ concurrently_ (runNode validator) reachNonceLim
        ctx <- atomically $ readTVar . _p2pTestContext $ validator
        Block.bestBlockNumber (_bestBlock ctx) `shouldNotBe` 0 --create at least 1 block
    it "will not add a canonical block that causes a stateroot mismatch" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 2]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos = 
              [
                CommonName "BlockApps" "Validator" "Node1" True, 
                CommonName "BlockApps" "Validator" "Node2" True
              ]
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8")
              ]
        
        ts <- liftIO getCurrentMicrotime
        let toIetx = IETx ts . IngestTx Origin.API
            src = "contract Test{}"
            txMd =  M.fromList [("src", src), ("name", "Test"), ("args", "()")]
            tx n =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce n,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Nothing,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code $ BC.pack src,
                  U.unsignedTransactionChainId = Nothing
                }
            signedTx p n = mkSignedTx (privKeys !! p) (tx n) txMd
            routine n = do
              flip postEvent (peers !! 0) . UnseqEvent . toIetx $ signedTx 1 n
              threadDelay 500000
              routine (n + 1)
        
        let corruptPBFT p2pev = case p2pev of 
              -- sneakily add on an extra tx
              P2pBlockstanbul (WireMessage auth (Preprepare v b)) -> P2pBlockstanbul (WireMessage auth (Preprepare v b{blockReceiptTransactions = (signedTx 0 0) : blockReceiptTransactions b}))
              msg -> msg
        conn <- createConnectionWithModifications (peers !! 0) (peers !! 1) corruptPBFT corruptPBFT -- oh no someone is corrupting msgs! :0
        
        void . timeout 2000000 $ concurrently_ (runNetworkOld peers [conn]) (routine 0)
        ctx <- atomically $ readTVar . _p2pTestContext $ peers !! 0
        Block.bestBlockNumber (_bestBlock ctx) `shouldBe` -1 -- no canonical blocks added (val starts at -1, not 0)

  describe "X.509 Private Chain exchange" $ do
    it "can add an organization to a private chain" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 3]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True
              ]
            zippedValidators = zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2)
                          ]
        ts <- liftIO getCurrentMicrotime
        cIdRef <- newIORef undefined
        cInfoRef <- newIORef undefined
        let runForTwelveSeconds = void . timeout 12000000
            toIetx = IETx ts . IngestTx Origin.API
            mkChainId = keccak256ToWord256 . rlpHash

            -- Post a mock dApp to a private chain
            src =
              [r|
                    contract A {
                      event OrgAdded(string name);

                      constructor() {}

                      function addOrg(string _name) {
                        emit OrgAdded(_name);
                      }
                    }
                    |]
            contractName = "A"
            chainMember1 = ChainMembers $ Set.singleton $ Org (T.pack "BlockApps") True
            args = "(\"Microsoft\")"
            txMd = M.fromList [("funcName", "addOrg"), ("args", args)]
            tChainInfo =
              signChain (privKeys !! 0) $
                UnsignedChainInfo
                  { chainLabel = "My organization's private chain",
                    accountInfo =
                      [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src),
                        NonContract (validatorAddresses !! 0) 1000000000000000000000,
                        NonContract (validatorAddresses !! 1) 1000000000000000000000
                      ],
                    codeInfo = [CodeInfo "" src $ Just contractName],
                    members = chainMember1,
                    parentChains = M.empty,
                    creationBlock = zeroHash,
                    chainNonce = 123456789,
                    chainMetadata = M.singleton "VM" "SolidVM"
                  }
            setupTx cId =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Just $ ChainId cId
                }
            signedPrivTx tx = mkSignedTx (privKeys !! 0) (setupTx tx) txMd

            routine = do
              threadDelay 200000
              for_ peers $ postEvent (TimerFire 0)
              threadDelay 200000
              let cInfo = tChainInfo
                  cId = mkChainId cInfo
              writeIORef cIdRef cId
              writeIORef cInfoRef cInfo
              flip postEvent (peers !! 0) . UnseqEvent . IEGenesis $ IngestGenesis Origin.API (cId, cInfo) -- Post private chain
              threadDelay 200000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx $ signedPrivTx cId -- Add organization to private chain
        runForTwelveSeconds $ concurrently_ (runNetworkOld peers connections') routine
        ctxs1 <- atomically $ traverse (readTVar . _p2pTestContext) peers
        testCid <- readIORef cIdRef

        -- Node 1's cert was registered in the contract so it should receive the chain ID
        (ctxs1 !! 1) ^. trueOrgNameChainsMap
          `shouldBe` M.singleton (Org "Microsoft" True) (TrueOrgNameChains $ Set.singleton testCid)

        -- Node 2's cert is not registered so it should not have any in the set
        (ctxs1 !! 2) ^. trueOrgNameChainsMap `shouldBe` M.empty

  -- TODO: milliseconds to seconds => threadDelayInSeconds :: Seconds -> IO ()

  describe "Testing contracts that call other contracts by addresss" $ do
    --Note to the developer
    --These contracts are shoved into the txrIndexer ..... Take this into consideration
    it "can call delegatecall function and not change state variables of contract being called" $ do
        privKeys <- traverse (const newPrivateKey) [(1 :: Integer) .. 4]
        let validatorAddresses = fromPrivateKey <$> privKeys
            validatorInfos =
              [ CommonName "BlockApps" "Engineering" "Admin" True,
                CommonName "Microsoft" "Sales" "Person" True,
                CommonName "Amazon" "Product" "Jeff Bezos" True
              ]
            zippedValidators = take 2 $ zip validatorAddresses validatorInfos
        certs <- traverse (uncurry selfSignCert) $ zip privKeys validatorInfos
        peers <-
          traverse (\((p, c), (n, i)) -> createPeer' p c zippedValidators certs n i) $
            zip
              (zip privKeys validatorInfos)
              [ ("node1", "1.2.3.4"),
                ("node2", "5.6.7.8"),
                ("node3", "9.10.11.12")
              ]
        connections' <- traverse
                          (\(a,b) -> createConnection a b)
                          [ (peers !! 0, peers !! 1),
                            (peers !! 0, peers !! 2),
                            (peers !! 1, peers !! 2)
                          ]
        ts <- liftIO getCurrentMicrotime
        let toIetx = IETx ts . IngestTx Origin.API
            args = "(\"Amazon\",\"Product\",\"Jeff Bezos\")"
            txMd = M.fromList [("funcName", "voteToAddValidator"), ("args", args)]
            setupTx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 0,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Just $ Address 0x100,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code "",
                  U.unsignedTransactionChainId = Nothing
                }
            signedTx = mkSignedTx (privKeys !! 0) setupTx txMd
  
            mainChainSrc =
              [r|
  contract B {
    uint y;
    string powPow = "Example of Different States";
  
    constructor() {
      y = 47;
    }
    function gg() returns(string) {return "Nice I did this";}
    function gg(int _x) returns(string) { return "Nice I did this taking an int arg";}
    function gg(int _x, int _b) returns(int) { return _x + _b;}
    function () external {y +=3; }
  }
  |]
            mainChainContractName = "B"
            mainChainArgs = "()"
            mainChainSrcC =
              [r|
  contract C {
    string powPow = "Other Example of different states";
    string getMoney;
    int x;
    uint y = 2;
    string yes;
    constructor(address _add) {
      getMoney = address(_add).delegatecall("gg()");
      x = address(_add).delegatecall("gg(int, int)", 333333333, 333333333);
      yes =  _add.delegatecall("gg()");
      _add.delegatecall("ggg()");
      //1.delegatecall("ggg()"); //This will make error.... because we shouldn't be able to call delegate on anything but an address type 
    }
  }
  |]
            mainChainContractNameC = "C"
            mainChainUtx =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 1,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Nothing,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code $ BC.pack mainChainSrc,
                  U.unsignedTransactionChainId = Nothing
                }
            mainChainUtx2 =
              U.UnsignedTransaction
                { U.unsignedTransactionNonce = Nonce 2,
                  U.unsignedTransactionGasPrice = Wei 1,
                  U.unsignedTransactionGasLimit = Gas 1000000000,
                  U.unsignedTransactionTo = Nothing,
                  U.unsignedTransactionValue = Wei 0,
                  U.unsignedTransactionInitOrData = Code $ BC.pack mainChainSrcC,
                  U.unsignedTransactionChainId = Nothing
                }
            mainChainTxMd = M.fromList [("src", mainChainSrc), ("name", mainChainContractName), ("args", mainChainArgs)]
            mkMainChainTx =
              let utx = mainChainUtx {U.unsignedTransactionNonce = Nonce 1}
               in mkSignedTx (privKeys !! 1) utx mainChainTxMd
  
            mainChainRoutine n = do
              threadDelay 200000
              flip postEvent (peers !! 1) . UnseqEvent . toIetx $ mkMainChainTx
              let x = getNewAddress_unsafe (fromPrivateKey (privKeys !! 1)) 1
  
              let args' = "(0x" <> T.pack (formatAddressWithoutColor x) <> ")"
              --liftIO $ putStrLn $ "Can I print here" ++ (show args') ++"\n\t" ++ (show  $ Account x Nothing) -- ++ "\n\t" ++ (show  $ xxx) -- Delete this for later
              let mainChainTxMdC = M.fromList [("src", mainChainSrcC), ("name", mainChainContractNameC), ("args", args')]
              let mkMainChainTx2 n' =
                    let utx = mainChainUtx2 {U.unsignedTransactionNonce = Nonce n'}
                     in mkSignedTx (privKeys !! 1) utx mainChainTxMdC
              flip postEvent (peers !! 1) . UnseqEvent . toIetx $ mkMainChainTx2 n
  
              mainChainRoutine $ n + 1
  
            routine = do
              threadDelay 200000
              for_ peers $ postEvent (TimerFire 0)
              threadDelay 1000000
              flip postEvent (peers !! 0) . UnseqEvent $ toIetx signedTx
              threadDelay 10000000
              runNetworkOld (drop 3 peers) (drop 3 connections')
  
        void . timeout 20000000 $ concurrently_ (runNetworkOld (take 3 peers) (take 3 connections')) (concurrently_ (void . timeout 4000000 $ mainChainRoutine 0) routine)
  
        bHash <- fmap (bestBlockHash . _bestBlock) . readTVarIO . _p2pTestContext $ peers !! 1
        let varsToLookUp = [".powPow", ".getMoney", ".y"]
        (contractA'sStateVars, contractB'sStateVars) <- runNoLoggingT . runResourceT . flip runReaderT (peers !! 1) $ do
          let contractALookup = map ((Account (getNewAddress_unsafe (fromPrivateKey (privKeys !! 1)) 1) Nothing),) varsToLookUp :: [(Account, BC.ByteString)]
          let contractBLookup = map ((Account (getNewAddress_unsafe (fromPrivateKey (privKeys !! 1)) 2) Nothing),) varsToLookUp :: [(Account, BC.ByteString)]
          valsOfA <- sequence $ map (\accountAndVarName -> (VMC.withCurrentBlockHash bHash $ do A.lookup (A.Proxy @RawStorageValue) accountAndVarName)) contractALookup
          valsOfB <- sequence $ map (\accountAndVarName -> (VMC.withCurrentBlockHash bHash $ do A.lookup (A.Proxy @RawStorageValue) accountAndVarName)) contractBLookup
          let fToPreform = map (\xxx' -> case xxx' of Just xxx -> Just $ fromVal xxx; Nothing -> Nothing)
          pure $ (fToPreform valsOfA, fToPreform valsOfB)
  
        contractA'sStateVars `shouldBe` [Just (BString "Example of Different States"), Nothing, Just (BInteger 47)]
        contractB'sStateVars `shouldBe` [Just (BString "Other Example of different states"), Just (BString "Nice I did this"), Just (BInteger 5)]
