{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NamedFieldPuns        #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}

module Blockchain.BlockChain
    ( addBlock
    , addBlocks
    , mineTransactions
    , addTransaction
    , addTransactions
    , outputTransactionResult
    , runCodeForTransaction
    , calculateIntrinsicGas'
    , compactDiffs -- For testing
  ) where

import           Conduit
import           Control.Arrow                           ((&&&))
import           Control.Lens.Operators
import           Control.Monad
import qualified Control.Monad.Change.Alter              as A
import qualified Control.Monad.Change.Modify             as Mod
import qualified Control.Monad.State                     as State
import           Control.Monad.Trans.Except
import           Data.Bifunctor                          (bimap)
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Short                   as BSS
import qualified Data.DList                              as DL
import           Data.Either.Extra
import           Data.Foldable                           (traverse_)
import           Data.List
import qualified Data.Map                                as M
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set                                as S
import qualified Data.Text                               as T
import           Data.Time.Clock
import           Prometheus                                as P
import           Text.PrettyPrint.ANSI.Leijen            (pretty)
import           Text.Printf
import           UnliftIO.IORef

import           BlockApps.Logging
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import           Blockchain.Data.Log
import           Blockchain.Data.Transaction
import           Blockchain.Data.TransactionDef          (formatChainId)
import           Blockchain.Data.TransactionResultStatus
import qualified Blockchain.Database.MerklePatricia      as MP
import qualified Blockchain.DB.AddressStateDB            as NoCache
import qualified Blockchain.DB.BlockSummaryDB            as BSDB
import           Blockchain.DB.ChainDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StorageDB
import           Blockchain.DB.X509CertDB
import           Blockchain.EVM.Code
import qualified Blockchain.EVM                          as EVM
import           Blockchain.Event
import           Blockchain.Sequencer.Event
import qualified Blockchain.SolidVM                      as SolidVM
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Gas
import           Blockchain.TheDAOFork
import           Blockchain.Verifier
import           Blockchain.VMContext
import           Blockchain.VM.VMException
import           Blockchain.VMConstants
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import qualified Blockchain.Bagger                       as Bagger
import           Blockchain.Bagger.Transactions
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Event
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.StateDiff             as SD

import           Blockchain.Strato.Indexer.Model         (IndexEvent (..))
import           Blockchain.Timing

import qualified Text.Colors                             as CL
import           Text.Format
import           Text.ShortDescription
import           Text.Tools

instance (Monad m, Mod.Accessible a m) => Mod.Accessible a (ConduitT i o m) where
  access = lift . Mod.access

instance Mod.Modifiable a m => Mod.Modifiable a (ConduitT i o m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance A.Selectable k v m => A.Selectable k v (ConduitT i o m) where
  select            p k  = lift $ A.select p k
  selectMany        p ks = lift $ A.selectMany p ks
  selectWithDefault p k  = lift $ A.selectWithDefault p k

instance (k `A.Alters` v) m => (k `A.Alters` v) (ConduitT i o m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k
  lookupWithDefault p k = lift $ A.lookupWithDefault p k

instance (Monad m, HasMemAddressStateDB m) => HasMemAddressStateDB (ConduitT i o m) where
  getAddressStateTxDBMap    = lift getAddressStateTxDBMap
  putAddressStateTxDBMap    = lift . putAddressStateTxDBMap
  getAddressStateBlockDBMap = lift getAddressStateBlockDBMap
  putAddressStateBlockDBMap = lift . putAddressStateBlockDBMap 

instance (Monad m, HasMemRawStorageDB m) => HasMemRawStorageDB (ConduitT i o m) where
  getMemRawStorageTxDB     = lift getMemRawStorageTxDB
  putMemRawStorageTxMap    = lift . putMemRawStorageTxMap
  getMemRawStorageBlockDB  = lift getMemRawStorageBlockDB
  putMemRawStorageBlockMap = lift. putMemRawStorageBlockMap

instance (Monad m, HasMemCertDB m) => HasMemCertDB (ConduitT i o m) where
  getCertTxDBMap    = lift getCertTxDBMap
  putCertTxDBMap    = lift . putCertTxDBMap
  getCertBlockDBMap = lift getCertBlockDBMap
  putCertBlockDBMap = lift . putCertBlockDBMap 

-- todo: lovely!

addBlocks :: (MonadFail m, VMBase m, Bagger.MonadBagger m, MonadMonitor m) => [OutputBlock] -> ConduitT a VmOutEvent m ()
addBlocks unfiltered = do
  let filtered = filter ((/= 0) . blockDataNumber . obBlockData) unfiltered
      timerToUse = Just vmBlockInsertionMined
  unless (null unfiltered) $ yieldMany $ OutIndexEvent . RanBlock <$> unfiltered
  bbi <- getContextBestBlockInfo
  $logInfoS "addBlocks" $ T.pack ("Unfiltered count: " ++ show (length unfiltered))
  $logInfoS "addBlocks" $ T.pack ("Filtered count: " ++ show (length filtered))
  case (filtered, bbi) of
    ([], _) -> return ()
    (_, Unspecified) -> return ()
    (firstBlock:_, ContextBestBlockInfo (_, oldHeader, _, _, _)) -> do
      $logInfoS "addBlocks" $ T.pack ("Inserting " ++ show (length filtered) ++ " blocks(s) starting with " ++
                                             (show . blockDataNumber . obBlockData $ firstBlock))
      didReplaceBest   <- newIORef False
      ranPrivateTxs    <- newIORef M.empty
      replacedBest     <- newIORef (error "addBlocks.replacedBest: evaluating uninitialized BestBlockInfo!")
      srLog <- fmap DL.toList . flip State.execStateT DL.empty $ forM_ filtered $ \block -> do
        let blockNo = blockDataNumber $! obBlockData block
            txCount = length $! obReceiptTransactions block
        timeit (printf "Block #%d (%d TXs insertion)" blockNo txCount) timerToUse $ do
          lift $ addBlock block
          (didReplaceThisTime, ranPriv, replacedBits@(hsh, num, _)) <- lift . lift $ replaceBestIfBetter block
          when didReplaceThisTime $ do
            writeIORef didReplaceBest True
            writeIORef replacedBest replacedBits
            -- Gather a chain of better block stateroots. The last one found should be the best block,
            -- and the intermediate ones increase the granularity at which we can compute a sequence
            -- of diffs. The number of blocks to skip between stateroots is determined by the cost of
            -- the diff between them, which is estimated by the number of transactions.
            id %= (`DL.snoc` (blockDataStateRoot $ obBlockData block, hsh, num, txCount))
          unless (M.null ranPriv) $
            modifyIORef' ranPrivateTxs $ flip M.unionWith ranPriv $
              \(n1,s1) (n2,s2) -> if n1 > n2 then (n1,s1) else (n2,s2)
      $logDebugLS "addBlocks/srLog" srLog
      didReplaceBest' <- readIORef didReplaceBest
      ranPrivateTxs' <- readIORef ranPrivateTxs
      when didReplaceBest' $ do
        $logInfoS "addBlocks" "done inserting, now will emit stateDiff if necessary"
        nbb <- readIORef replacedBest
        yield . OutIndexEvent $ NewBestBlock nbb
        when flags_sqlDiff $ timeit "calculateAndEmitStateDiffs " timerToUse $
          calculateAndEmitStateDiffs srLog oldHeader
      when (flags_sqlDiff && not (M.null ranPrivateTxs')) $ calculateAndEmitChainDiffs ranPrivateTxs'

setParentStateRoot :: ( MonadFail m, MonadIO m, BSDB.HasBlockSummaryDB m)
                   => OutputBlock -> m BlockSummary
setParentStateRoot OutputBlock{..} = do
    liftIO $ setTitle $ "Block #" ++ show (blockDataNumber obBlockData)
    BSDB.getBSum (blockDataParentHash obBlockData)

addBlock :: (MonadFail m, VMBase m, Bagger.MonadBagger m, MonadMonitor m) => OutputBlock -> ConduitT a VmOutEvent m ()
addBlock b@OutputBlock{obBlockData = bd, obBlockUncles = uncles, obReceiptTransactions = otxs} =
  let obh = outputBlockHash b in withCurrentBlockHash obh $ do
    $logInfoS "addBlocks" . T.pack $
      "Inserting Block #"
      ++ show (blockDataNumber . obBlockData $ b)
      ++ " ("
      ++ format obh
      ++ ", " ++ show (length otxs)
      ++ "TXs)."
    when flags_debug $ do
      bhr <- Mod.get (Proxy @BlockHashRoot)
      $logDebugS "addBlock" $ T.pack $ "Old blockhash root: " ++ format bhr
      mcr <- getChainRoot $ blockHash b
      case mcr of
        Nothing -> $logDebugS "addBlock" $ T.pack $ "Could not locate old chain root. Using emptyTriePtr"
        Just cr -> $logDebugS "addBlock" $ T.pack $ "Old chain root: " ++ format cr

    putBlockHeaderInChainDB bd
    putBlockHeaderInCertDB bd

    when flags_debug $ do
      bhr' <- Mod.get (Proxy @BlockHashRoot)
      $logDebugS "addBlock" $ T.pack $ "New blockhash root after inserting header: " ++ format bhr'
      mcr' <- getChainRoot $ blockHash b
      case mcr' of
        Nothing -> $logDebugS "addBlock" $ T.pack $ "Could not locate new chain root after inserting header. Using emptyTriePtr"
        Just cr -> $logDebugS "addBlock" $ T.pack $ "New chain root after inserting header: " ++ format cr

    bSum <- setParentStateRoot b
    when (False && blockDataNumber bd == 1920000) runTheDAOFork -- TODO: Only run this if connected to Ethereum publicnet (i.e. never)

    addBlockTransactions b

    postRewardSR <- lift $ Bagger.rewardCoinbases (blockDataCoinbase bd) uncles (blockDataNumber bd)

    when (blockDataStateRoot (obBlockData b) /= postRewardSR) $ do
      $logInfoS "addBlock/mined" . T.pack $ "newStateRoot: " ++ format postRewardSR
      error $ "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format (blockDataStateRoot $ obBlockData b)

    valid <- checkValidity (blockIsHomestead $ blockDataNumber bd) bSum b
    case valid of
        Nothing -> lift $ P.incCounter vmBlocksValid
        Just  _ -> lift $ P.incCounter vmBlocksInvalid -- error err -- todo: i dont think we ACTUALLY need to error here

    when flags_debug $ do
      bhr'' <- Mod.get (Proxy @BlockHashRoot)
      $logDebugS "addBlock" $ T.pack $ "New blockhash root after running block: " ++ format bhr''
      mcr'' <- getChainRoot $ blockHash b
      case mcr'' of
        Nothing -> $logDebugS "addBlock" $ T.pack $ "Could not locate new chain root after running block. Using emptyTriePtr"
        Just cr -> $logDebugS "addBlock" $ T.pack $ "New chain root after running block: " ++ format cr

    lift $ P.incCounter vmBlocksMined
    lift $ P.incCounter vmBlocksProcessed
    $logInfoS "addBlock" .  T.pack $ "Inserted block became #" ++ show (blockDataNumber $ obBlockData b) ++ " (" ++ format obh ++ ")."

addBlockTransactions :: (VMBase m, Bagger.MonadBagger m, MonadMonitor m) => OutputBlock -> ConduitT a VmOutEvent m ()
addBlockTransactions OutputBlock{obBlockData = bd, obReceiptTransactions = transactions} = do
  $logDebugS "addBlockTransactions" . T.pack $ "All transactions: " ++ show transactions
  $logDebugS "addBlockTransactions" . T.pack $ "AnchorChains: " ++ show (map (otAnchorChain &&& txType) transactions)
  let txs = filter (\t -> (txType t /= PrivateHash) || (isJust $ otPrivatePayload t))
          $ filter (isAnchored . otAnchorChain) transactions
  -- TODO: Run the checks Bagger does reject invalid transactions for private chains
  addTransactions bd txs

  lift $ timeit "flushMemStorageDB" (Just vmBlockInsertionMined) flushMemStorageDB
  lift $ timeit "flushMemAddressStateDB" (Just vmBlockInsertionMined) flushMemAddressStateDB
  lift $ timeit "flushMemCertDB" (Just vmBlockInsertionMined) $ flushMemCertDB . unCurrentBlockHash =<< Mod.get (Mod.Proxy @CurrentBlockHash)

addTransactions :: (VMBase m, Bagger.MonadBagger m, MonadMonitor m)
                => BlockData
                -> [OutputTx]
                -> ConduitT a VmOutEvent m ()
addTransactions blockData txs =
 timeit ("addTransactions, " ++ show (length txs) ++ " TXs") (Just vmBlockInsertionMined) $ do
  trrs <- lift $ go (blockDataGasLimit blockData) txs DL.empty
  mapM_ (outputTransactionResult blockData blockHeaderHash) trrs
  yield . OutASM $ foldr (flip M.union) M.empty $ map trrAfterMap trrs

  where
    go _ [] trrs = return $ DL.toList trrs
    go blockGas (t:rest) trrs = do
      let bt = fromMaybe (otBaseTx t) (otPrivatePayload t)
      flushMemAddressStateTxToBlockDB
      flushMemStorageTxDBToBlockDB
      flushMemCertTxToBlockDB
      beforeMap <- getAddressStateTxDBMap
      let chainId = fromAnchorChain $ otAnchorChain t
      (!deltaT, !result) <- timeIt $ runExceptT $ addTransaction chainId False blockData blockGas t

      afterMap <- getAddressStateTxDBMap

      printTransactionMessage t result deltaT (txChainId bt)
      P.setGauge vmTxMined (realToFrac deltaT)

      trr <- setNewAddresses $ TxRunResult t result deltaT beforeMap afterMap []

      let remainingBlockGas =
            case result of
            Left _           -> blockGas
            Right execResult -> blockGas - (transactionGasLimit bt - calculateReturned bt execResult)

      go remainingBlockGas rest (trrs `DL.snoc` trr)

mineTransactions :: (VMBase m, MonadMonitor m) => Bagger.MineTransactions m
mineTransactions bd remGas otxs = mineTransactions' bd remGas DL.empty otxs
  
mineTransactions' :: (VMBase m, MonadMonitor m) => BlockData -> Integer -> DL.DList TxRunResult -> [OutputTx] -> m Bagger.TxMiningResult
mineTransactions' _ remGas ran [] = return $ Bagger.TxMiningResult Nothing (DL.toList ran) [] remGas
mineTransactions' header remGas ran unran@(tx:txs) = do
    let bt = fromMaybe (otBaseTx tx) (otPrivatePayload tx)
    beforeMap <- getAddressStateTxDBMap
    (!time', !result) <- timeIt . runExceptT $ addTransaction Nothing False header remGas tx
    afterMap <- getAddressStateTxDBMap
    P.setGauge vmTxMining (realToFrac time')
    printTransactionMessage tx result time' (txChainId bt)
    trr <- setNewAddresses $ TxRunResult tx result time' beforeMap afterMap []
    case result of
        Right execResult -> do

          let supportedPragmas = [("svm","3.0"),("svm","3.2"),("svm","3.3")]
              findInvalidPragmas pragma = if pragma `elem` supportedPragmas then id else (pragma:)
              invalidPragmasUsed = foldr findInvalidPragmas [] (erPragmas execResult) 
           in if not $ null invalidPragmasUsed
                 then return $ Bagger.TxMiningResult (Just $ TFInvalidPragma invalidPragmasUsed tx)  (DL.toList ran) unran remGas -- use invalidPragmasUsed here

                 else do
                   let nextRemGas = remGas - (transactionGasLimit bt-calculateReturned bt execResult)
                   flushMemAddressStateTxToBlockDB
                   flushMemStorageTxDBToBlockDB
                   Mod.put (Mod.Proxy @(M.Map Address X509Certificate)) $ M.union (erNewX509Certs execResult) beforeX509s
                   mineTransactions' header nextRemGas (ran `DL.snoc` trr) txs

        Left  failure    -> do Mod.put (Mod.Proxy @(M.Map Address X509Certificate)) beforeX509s -- revert changes to X509 map
                               return $ Bagger.TxMiningResult (Just failure) (DL.toList ran) unran remGas


blockIsHomestead :: Integer -> Bool
blockIsHomestead blockNum = blockNum >= fromIntegral gHomesteadFirstBlock

addTransaction :: (VMBase m, MonadMonitor m)
               => Maybe Word256
               -> Bool
               -> BlockData
               -> Integer
               -> OutputTx
               -> ExceptT TransactionFailureCause m ExecResults
addTransaction chainId isRunningTests' b remainingBlockGas t@OutputTx{otSigner=tAddr} = do

    nonceValid <- lift $ isNonceValid t

    let isHomestead   = blockIsHomestead $ blockDataNumber b
        intrinsicGas' = intrinsicGas isHomestead t
        tAcct = Account tAddr chainId
        bt = fromMaybe (otBaseTx t) (otPrivatePayload t)

    when flags_debug $ do
        $logDebugS "addTx" . T.pack $ "bytes cost: " ++ show (gTXDATAZERO * fromIntegral (zeroBytesLength t) + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - fromIntegral (zeroBytesLength t)))
        $logDebugS "addTx" . T.pack $ "transaction cost: " ++ show gTX
        $logDebugS "addTx" . T.pack $ "intrinsicGas: " ++ show intrinsicGas'

    let txCost = transactionGasLimit bt * transactionGasPrice bt + transactionValue bt
        realIG = fromIntegral intrinsicGas'
        maxGas = fromIntegral (maxBound :: Int)
    
    unless flags_gasOn $ do
        $logInfoS "addTx" . T.pack $ "gas is off, so I'm giving the account enough balance for this TX"
        faucetSuccess <- lift $ addToBalance tAcct txCost
        unless faucetSuccess $ error "failed to give balance to a gasOff account"
    
    (acctBalance, acctNonce) <- lift $
      (addressStateBalance &&& addressStateNonce) <$>
        A.lookupWithDefault (Proxy @AddressState) tAcct
   
    when (chainId /= txChainId bt) $ throwE $ TFChainIdMismatch chainId (txChainId bt) t
    when (txCost > acctBalance) $ throwE $ TFInsufficientFunds txCost acctBalance t
    when (realIG > transactionGasLimit bt) $ throwE $ TFIntrinsicGasExceedsTxLimit realIG (transactionGasLimit bt) t
    when (transactionGasLimit bt > min remainingBlockGas maxGas) $ throwE $ TFBlockGasLimitExceeded (transactionGasLimit bt) remainingBlockGas t
    unless nonceValid $ throwE $ TFNonceMismatch (transactionNonce bt) acctNonce t

    let availableGas = transactionGasLimit bt - fromIntegral intrinsicGas'

    lift $ incrementNonce tAcct
    
     
    success <- lift $ addToBalance tAcct (-transactionGasLimit bt * transactionGasPrice bt)
    when flags_debug $ $logDebugS "addTx" "running code"
    let txTypeCounter = if isContractCreationTX bt then vmTxsCreation else vmTxsCall
        coinbaseAcct = Account (blockDataCoinbase b) chainId
    lift $ P.incCounter txTypeCounter
    if success
        then do
            execResults <- runCodeForTransaction isRunningTests' isHomestead b (fromInteger (transactionGasLimit bt) - intrinsicGas') tAcct t
            s1 <- lift $ addToBalance coinbaseAcct (transactionGasLimit bt * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addBlock"
            lift $ P.incCounter vmTxsProcessed

            success' <- lift $ pay "VM refund fees" coinbaseAcct tAcct (calculateReturned bt execResults * transactionGasPrice bt)
            unless success' $ error "oops, refund was too much"

            case erException execResults of
                Just e -> do
                    when flags_debug $ $logDebugS "addTx" . T.pack . CL.red $ show e
                    lift $ P.incCounter vmTxsUnsuccessful
                Nothing -> do
                    when flags_debug $ $logDebugS "addTx" . T.pack $ "Removing accounts in suicideList: " ++ intercalate ", " (show . pretty <$> S.toList (erSuicideList execResults))
                    forM_ (S.toList $ erSuicideList execResults) $ \address' -> do
                        lift $ purgeStorageMap address'
                        lift $ A.delete (Proxy @AddressState) address'
                    lift $ P.incCounter vmTxsSuccessful
            return execResults
        else do
            s1 <- lift $ addToBalance coinbaseAcct (fromIntegral intrinsicGas' * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addTransaction"
            balance <- lift $ addressStateBalance <$>
              A.lookupWithDefault (Proxy @AddressState) tAcct
            $logInfoS "addTransaction/success=false" . T.pack $ "Insufficient funds to run the VM: need " ++ show (availableGas*transactionGasPrice bt) ++ ", have " ++ show balance
            return $
              evmErrorResults (transactionGasLimit bt) Blockchain.VM.VMException.InsufficientFunds

runCodeForTransaction :: VMBase m
                      => Bool
                      -> Bool
                      -> BlockData
                      -> Gas
                      -> Account
                      -> OutputTx
                      -> ExceptT TransactionFailureCause m ExecResults
runCodeForTransaction isRunningTests' isHomestead b availableGas tAcct t =
  let ut = fromMaybe (otBaseTx t) (otPrivatePayload t)
   in if isContractCreationTX ut
        then do
          when flags_debug $ $logInfoS "runCodeForTransaction" "runCodeForTransaction: ContractCreationTX"

          let create =
                case join $ fmap (M.lookup "VM") $ transactionMetadata ut of
                  Just "EVM" -> EVM.create
                  Just "SolidVM" -> SolidVM.create
                  Nothing -> EVM.create --EVM is the default
                  Just vmName -> -- Return a dummy VM that just complains that the requested VM doesn't exist
                    \_ _ _ _ _ _ _ _ _ ag _ _ _ _ _ ->
                                 return $ evmErrorResults (toInteger ag) (UnsupportedVM vmName)

          --TODO- The new address state should be created in the VM itself....  Currently the EVM doesn't do this (and could be cleaned up by doing so), SolidVM does do this.  I will calculate this value here, but then ignore the value in SolidVM (and recalculate it there).  Eventually this should be moved into the EVM also
          nonce <- lift $ addressStateNonce <$> A.lookupWithDefault (Proxy @AddressState) tAcct
          let newAddress = getNewAddress_unsafe (tAcct ^. accountAddress) (nonce-1) --nonce has already been incremented, so subtract 1 here to get the proper value (this is directly specified in the yellowpaper)
              newAccount = Account newAddress (txChainId ut)

          lift $ create isRunningTests'
                   isHomestead
                   S.empty
                   b
                   0
                   tAcct
                   tAcct
                   (transactionValue ut)
                   (fromInteger $ transactionGasPrice ut)
                   availableGas
                   newAccount
                   (transactionInit ut)
                   (txHash ut)
                   (txChainId ut)
                   (txMetadata ut)
        else do
          when flags_debug $ $logInfoS "runCodeForTransaction"  $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ format tAcct ++ ", address: " ++ format (transactionTo ut)

          let owner = Account (transactionTo ut) (txChainId ut)

          codeHash <- lift $ addressStateCodeHash <$> A.lookupWithDefault (Proxy @AddressState) owner
          resolvedCodeHash <- lift $ resolveCodePtr (owner ^. accountChainId) codeHash

          let eCall =
                case codeHash of
                  EVMCode _ -> Right EVM.call
                  SolidVMCode _ _ ->  Right SolidVM.call
                  CodeAtAccount acct name -> case resolvedCodeHash of
                    Just (EVMCode _) -> Right EVM.call
                    Just (SolidVMCode _ _) -> Right SolidVM.call
                    Just (CodeAtAccount acct' name') -> Left (acct', name')
                    Nothing -> Left (acct, name)

          case eCall of
            Left (acct, name) -> throwE $ TFCodeCollectionNotFound acct name t
            Right call -> lift $
              call isRunningTests'
                isHomestead
                False
                False
                S.empty
                b
                0
                owner
                owner
                tAcct
                (fromInteger $ transactionValue ut)
                (fromInteger $ transactionGasPrice ut)
                (transactionData ut)
                (fromIntegral availableGas)
                tAcct
                (txHash ut)
                (txChainId ut)
                (txMetadata ut)

----------------


codeOrDataLength :: OutputTx -> Int
codeOrDataLength t =
  let bt = fromMaybe (otBaseTx t) (otPrivatePayload t)
   in if isMessageTX bt
        then B.length $ transactionData bt
        else codeLength $ transactionInit bt --is ContractCreationTX

zeroBytesLength :: OutputTx -> Int
zeroBytesLength t =
  let bt = fromMaybe (otBaseTx t) (otPrivatePayload t)
   in if isMessageTX bt
        then length $ filter (==0) $ B.unpack $ transactionData bt
        else length $ filter (==0) $ B.unpack $ codeBytes' bt --is ContractCreationTX
  where
    codeBytes' bt = case transactionInit bt of
      Code cb -> cb
      PtrToCode _ -> "" -- TODO: lookup code?

calculateIntrinsicGas' :: Integer -> OutputTx -> Gas
calculateIntrinsicGas' blockNum = intrinsicGas (blockIsHomestead blockNum)

intrinsicGas :: Bool -> OutputTx -> Gas
intrinsicGas isHomestead t =
  let bt = fromMaybe (otBaseTx t) (otPrivatePayload t)
   in gTXDATAZERO * zeroLen + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - zeroLen) + txCost bt
  where
    zeroLen = fromIntegral $ zeroBytesLength t
    txCost t' | isMessageTX t' = gTX
    txCost _  = if isHomestead then gCREATETX else gTX

setNewAddresses :: VMBase m => TxRunResult -> m TxRunResult
setNewAddresses trr@(TxRunResult _ result _ before after _) = do
  let isMod ASModification{} = True
      isMod ASDeleted = False

      split :: M.Map Account AddressStateModification -> (S.Set Account, S.Set Account)
      split = bimap (S.fromList . M.keys) (S.fromList . M.keys) . M.partition isMod
      (beforeAddresses, beforeDeletes) = split before
      (afterAddresses, afterDeletes) = split after
      modified = (afterAddresses S.\\ afterDeletes) S.\\ (beforeAddresses S.\\ beforeDeletes)
      moveToFront (Just thisAddress) | thisAddress `S.member` modified = thisAddress : S.toList (S.delete thisAddress modified)
      moveToFront _ = S.toList modified
  case result of
    Left{} -> return trr
    Right erResult -> do
      unseen <- filterM (fmap not . NoCache.addressStateExists) . moveToFront $ erNewContractAccount erResult
      return trr{trrNewAddresses = unseen}


outputTransactionResult :: VMBase m
                        => BlockData
                        -> (BlockData -> Keccak256)
                        -> TxRunResult
                        -> ConduitT a VmOutEvent m ()
outputTransactionResult b hashFunction (TxRunResult ot@OutputTx{otHash=theHash} result deltaT beforeMap afterMap newAddresses) = do
  let t = fromMaybe (otBaseTx ot) (otPrivatePayload ot)
      (txrStatus, message, gasRemaining) =
        case result of
          Left err -> let fmt = format err in (Failure "Execution" Nothing (ExecutionFailure fmt) Nothing Nothing (Just fmt), fmt, 0) -- TODO Also include the trace
          Right r  -> case erException r of
                        Nothing -> (Success, "Success!", erRemainingTxGas r)
                        Just ex -> let fmt = either show show ex
                                    in (Failure "Execution" Nothing (ExecutionFailure $ show ex) Nothing Nothing (Just fmt), fmt, 0)
      gasUsed = fromInteger $ transactionGasLimit t - gasRemaining
      etherUsed = gasUsed * fromInteger (transactionGasPrice t)

      chainId = txChainId t
      beforeAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList beforeMap ]
      beforeDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList beforeMap ]
      afterAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList afterMap ]
      afterDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList afterMap ]
      ranBlockHash = hashFunction b
      mkLogEntry Log{..} = LogDB ranBlockHash theHash chainId (account ^. accountAddress) (topics `indexMaybe` 0) (topics `indexMaybe` 1) (topics `indexMaybe` 2) (topics `indexMaybe` 3) logData bloom
      mkEventEntry Event{..} = EventDB evContractAccount chainId evName $ map snd evArgs -- drop the field names, only slipstream needs them
      (!response, theTrace', theLogs, theEvents) =
        case result of
          Left _ -> (BSS.empty, [], [], []) --TODO keep the trace when the run fails
          Right r ->
            (fromMaybe BSS.empty $ erReturnVal r, unlines $ reverse $ erTrace r, erLogs r, erEvents r)

  yieldMany $ OutLog . mkLogEntry <$> theLogs
  yieldMany $ OutEvent . mkEventEntry <$> theEvents
  when flags_createTransactionResults $ do
    yield . OutTXR $
           TransactionResult { transactionResultBlockHash        = ranBlockHash
                             , transactionResultTransactionHash  = theHash
                             , transactionResultMessage          = message
                             , transactionResultResponse         = response
                             , transactionResultTrace            = theTrace'
                             , transactionResultGasUsed          = gasUsed
                             , transactionResultEtherUsed        = etherUsed
                             , transactionResultContractsCreated = intercalate "," $ map (show . _accountAddress) newAddresses
                             , transactionResultContractsDeleted = intercalate "," $ map (show . _accountAddress) $ S.toList $ (beforeAddresses S.\\ afterAddresses) `S.union` (afterDeletes S.\\ beforeDeletes)
                             , transactionResultStateDiff        = ""
                             , transactionResultTime             = realToFrac deltaT
                             , transactionResultNewStorage       = ""
                             , transactionResultDeletedStorage   = ""
                             , transactionResultStatus           = Just txrStatus
                             , transactionResultChainId          = chainId
                             , transactionResultKind             = erKind <$> eitherToMaybe result
                             }
  when flags_diffPublish $ do
    traverse_ (yield . OutAction) $ either (const Nothing) erAction result

multilineLog :: MonadLogger m =>
                T.Text -> String -> m ()
multilineLog source theLines = do
  forM_ (lines theLines) $ \theLine ->
    $logInfoS source $ T.pack theLine

printTransactionMessage::MonadLogger m=>
                         OutputTx->Either TransactionFailureCause ExecResults->NominalDiffTime->Maybe Word256 ->  m ()
printTransactionMessage ot@OutputTx{otSigner=tAddr, otHash=theHash} (Left errMsg) deltaT cid = do
  let baseTx = fromMaybe (otBaseTx ot) (otPrivatePayload ot)
      tNonce = transactionNonce baseTx
  multilineLog "printTx/err" $ boringBox
    [ "Adding transaction signed by: " ++ format tAddr
    , "Tx hash:  " ++ format theHash
    , "Tx nonce: " ++ show tNonce
    , "Chain Id: " ++ formatChainId cid
    , CL.red "Transaction failure: " ++ CL.red (format errMsg)
    , "t = " ++ printf "%.5f" (realToFrac deltaT::Double) ++ "s"
    ]

printTransactionMessage ot@OutputTx{otSigner=tAddr, otHash=theHash} (Right results) deltaT cid = do
    let t = fromMaybe (otBaseTx ot) (otPrivatePayload ot)
        tNonce = transactionNonce t
        extra =
          if isMessageTX t
          then ""
          else fromMaybe "<failed>" $ fmap format $ erNewContractAccount results

    multilineLog "printTx/ok" $ boringBox
      [ "Adding transaction signed by: " ++ format tAddr
      , "Tx hash:  " ++ format theHash
      , "Tx nonce: " ++ show tNonce
      , "Chain Id: " ++ formatChainId cid
      , shortDescription t ++ " " ++ extra
      , "t = " ++ printf "%.5f" (realToFrac deltaT::Double) ++ "s"
      ]

indexMaybe :: [a] -> Int -> Maybe a
indexMaybe _ i        | i < 0 = error "indexMaybe called for i < 0"
indexMaybe [] _       = Nothing
indexMaybe (x:_) 0    = Just x
indexMaybe (_:rest) i = indexMaybe rest (i-1)

----------------

replaceBestIfBetter :: (VMBase m, Bagger.MonadBagger m) => OutputBlock -> m (Bool, M.Map Word256 (Integer, Keccak256), (Keccak256, Integer, Integer))
replaceBestIfBetter b@OutputBlock{obBlockData = bd, obTotalDifficulty = td, obReceiptTransactions=txs, obBlockUncles=uncles} = do
    let txPayloads = (\t -> fromMaybe (otBaseTx t) (otPrivatePayload t)) <$> txs
    bbi <- getContextBestBlockInfo

    case bbi of
      Unspecified -> error $ "Trying to replace an Unspecified Best Block"
      ContextBestBlockInfo (oldBestSha, oldBestBlock, oldBestDifficulty, oldTxCount, _) -> do

        let newNumber     = blockDataNumber bd
            newStateRoot  = blockDataStateRoot bd
            newTxCount    = fromIntegral $ length txs
            newUncleCount = fromIntegral $ length uncles
            oldNumber     = blockDataNumber oldBestBlock
            oldStateRoot  = blockDataStateRoot oldBestBlock
            bH            = outputBlockHash b
            bTHs          = otHash <$> txs

        let shouldReplace =     newNumber == 0
                            || (newNumber > oldNumber)
                            || ((newNumber == oldNumber) && (td > oldBestDifficulty))
                            || ((newNumber == oldNumber) && (td == oldBestDifficulty) && (newTxCount > oldTxCount))
            ranPriv = M.fromSet (const (newNumber, bH)) . S.fromList . catMaybes $ map txChainId txPayloads

        $logInfoS "replaceBestIfBetter" . T.pack $ "shouldReplace = " ++ show shouldReplace ++ ", newNumber = " ++ show newNumber ++ ", oldBestNumber = " ++ show (blockDataNumber oldBestBlock)

        when shouldReplace $ do
            Bagger.processNewBestBlock bH bd bTHs
            putContextBestBlockInfo $ ContextBestBlockInfo (bH, bd, td, newTxCount, newUncleCount)

        -- we're replaying SeqEvents, and need to notify the mempool
        when (not shouldReplace && (newNumber == oldNumber) && (oldStateRoot == newStateRoot)) $
            Bagger.processNewBestBlock bH bd bTHs

        let bbi'      = (bestSha, bestNum, bestTdiff)
            bestSha   = if shouldReplace then bH        else oldBestSha
            bestNum   = if shouldReplace then newNumber else oldNumber
            bestTdiff = if shouldReplace then td        else oldBestDifficulty

        return (shouldReplace, ranPriv, bbi')

calculateAndEmitStateDiffs :: VMBase m
                           => [(MP.StateRoot, Keccak256, Integer, Int)]
                           -> BlockData
                           -> ConduitT a VmOutEvent m ()
calculateAndEmitStateDiffs srLog oldHeader = do
  let base = MP.StateRoot $ blockHeaderStateRoot oldHeader
      diffLog = compactDiffs base srLog
  runConduit $ yieldMany diffLog
            .| mapMC completeDiff
            .| mapM_C (yield . OutStateDiff)

calculateAndEmitChainDiffs :: VMBase m => M.Map Word256 (Integer, Keccak256) -> ConduitT a VmOutEvent m ()
calculateAndEmitChainDiffs chainMap = do
  let chainList = M.toList chainMap
      chainIds = format . unsafeCreateKeccak256FromWord256 . fst <$> chainList
  $logInfoS "calculateAndEmitChainDiffs" . T.pack $ "Calculating ChainDiffs for: " ++ show chainIds
  runConduit $ yieldMany chainList
            .| mapMC (\(cId, (newNumber, newHash)) -> withCurrentBlockHash newHash $ SD.chainDiff (Just cId) newNumber newHash)
            .| mapM_C (traverse_ $ yield . OutStateDiff)

diffMaxCost :: Int
diffMaxCost = 500

type PreDiff = (MP.StateRoot, Keccak256, Integer, Int)
type ToDiff = (MP.StateRoot, MP.StateRoot, Keccak256, Integer)

promote :: MP.StateRoot -> PreDiff -> ToDiff
promote base (next, hsh, num, _) = (base, next, hsh, num)

cost :: PreDiff -> Int
cost (_, _, _, c) = c

compactDiffs :: MP.StateRoot -> [PreDiff] -> [ToDiff]
compactDiffs _ [] = error "should not be called on an empty list"
compactDiffs base (p:ps) = go (cost p) (promote base p) ps
  where go :: Int -> ToDiff -> [PreDiff] -> [ToDiff]
        go _ lastPending [] = [lastPending]
        go pendingCost pending@(pendingBase, pendingNext, _, _) (c:cs) =
          -- If we can fit this PreDiff in, we augment it to the pending ToDiff.
          -- Otherwise, we emit and create a new ToDiff
          if pendingCost + cost c > diffMaxCost
            then pending:go (cost c) (promote pendingNext c) cs
            else go (pendingCost + cost c) (promote pendingBase c) cs

completeDiff :: ( MonadLogger m
                , HasCodeDB m
                , HasHashDB m
                , Mod.Modifiable MemDBs m
                , Mod.Modifiable CurrentBlockHash m
                , Mod.Modifiable BestBlockRoot m
                , Mod.Modifiable CertRoot m
                , HasMemAddressStateDB m
                , (MP.StateRoot `A.Alters` MP.NodeData) m
                , (Account `A.Alters` AddressState) m
                , (Maybe Word256 `A.Alters` MP.StateRoot) m
                , HasMemRawStorageDB m
                , (RawStorageKey `A.Alters` RawStorageValue) m
                , HasMemCertDB m
                )
             => ToDiff -> m SD.StateDiff
completeDiff (src, dst, hsh, num) = withCurrentBlockHash hsh $ do
  $logInfoS "calculateAndEmitStateDiffs" . T.pack $
      "Calculating StateDiff from: " ++ format src ++ "\nto: " ++ format dst
  SD.stateDiff Nothing num hsh src dst
