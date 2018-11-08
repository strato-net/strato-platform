{-# LANGUAGE
      DataKinds
    , DeriveGeneric
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , LambdaCase
    , OverloadedStrings
    , QuasiQuotes
    , RecordWildCards
    , ScopedTypeVariables
    , TemplateHaskell
#-}

module Slipstream.Processor where

import Control.Arrow ((&&&))
import Control.Monad.Except
import Control.Monad.Log    hiding (Handler)
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Either (lefts,rights)
import Data.Int (Int32)
import Data.IORef
import Data.Foldable (for_)
import Data.Function
import qualified Data.Map.Ordered as OMap
import qualified Data.Map as Map
import Data.Monoid ((<>))
import Data.Pool
import Data.Maybe
import qualified Data.Text as T
import Data.Traversable (for)
import Data.Text (Text)
import Data.Text.Encoding (decodeUtf8)
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Typed
import Network.HTTP.Client
import Numeric
import Servant.Common.BaseUrl
import System.Log.Logger

import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Ethereum
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Type
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Value
import BlockApps.Solidity.Xabi
import BlockApps.XAbiConverter
import qualified BlockApps.SolidityVarReader as SVR

import Slipstream.Data.Action
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Options
import Slipstream.OutputData
import Slipstream.SolidityValue

toAction :: BL.ByteString -> Action'
toAction x =
 case JSON.eitherDecode x of
  Left e -> error $ show e
  Right y -> y

enterBloc2 :: BlocEnv -> Bloc x -> IO x
enterBloc2 env x = do
  ret <-
    runExceptT
    $ flip runLoggingT (filterPrintLog $ logLevel env)
    $ flip runReaderT env $ runBloc x

  case ret of
   Left e -> error $ show e
   Right v -> return v

emptyHash :: Keccak256
emptyHash = keccak256 B.empty

hasContract::Action->Bool
hasContract = (/= emptyHash) . actionCodeHash

matters :: Action -> Bool
matters Action{..} = (actionType == Create) || (not . Map.null $ actionStorage)

on2 :: (b -> b -> c) -> ((a -> a -> b), (a -> a -> b)) -> a -> a -> c
on2 f p = curry ((uncurry f) . ((uncurry (fst p)) &&& (uncurry (snd p))))

isSameCreateAs :: Action -> Action -> Bool
isSameCreateAs = (&&) `on2` (((&&) `on` ((== Create) . actionType)), ((==) `on` actionCodeHash))

groupSimilarActions :: [Action] -> [[Action]]
groupSimilarActions as = go as [] []
  where
    go [] _ final = final
    go [x] tmp final = final ++ [tmp ++ [x]]
    go (x:y:rest) tmp final =
      let newTmp = tmp ++ [x]
       in if isSameCreateAs x y
            then go (y:rest) newTmp final
            else go (y:rest) [] (final ++ [newTmp])

withNothing :: Applicative f => Maybe a -> f (Maybe a) -> f (Maybe a)
withNothing m f = maybe f (pure . Just) m

functionDetailsFromContract :: Contract -> ByteString -> (Text, ([(Text, Type)],[(Maybe Text, Type)]))
functionDetailsFromContract contract selector' =
  let selector = B.take 4 selector'
      isSelector = \case
        TypeFunction s a r | s == selector -> Just (a,r)
        _                                  -> Nothing
   in fromMaybe ("",([],[]))
      . listToMaybe
      . map (fmap fromJust)
      . filter (isJust . snd)
      . map (fmap (isSelector . snd))
      $ OMap.assocs
        (fields $ mainStruct contract)

getFunctionDetailsFromSelector :: Int32 -> ByteString -> Bloc (Text, ([(Text,Type)],[(Maybe Text, Type)]))
getFunctionDetailsFromSelector cmId sel' = do
  contract' <- getContractContractByMetadataId cmId
  return $ functionDetailsFromContract contract' sel'

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

convertByteStringToVals :: ByteString -> [Type] -> Maybe [SolidityValue]
convertByteStringToVals byteResp responseTypes = map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

getFunctionCallValues :: Int32 -> ByteString -> ByteString -> Bloc (Text, [(Text, SolidityValue)], [(Text, SolidityValue)])
getFunctionCallValues cmId input' output' = do
  let sel = B.take 4 input'
      data' = B.drop 4 input'
  (fname,(itypes,otypes)) <- getFunctionDetailsFromSelector cmId sel
  let typemap bs = uncurry zip
                   . fmap ( fromMaybe (repeat (SolidityValueAsString ""))
                     . convertByteStringToVals bs
                     . map convertEnumTypeToInt
                   ) . unzip
      imap = typemap data' itypes
      omap = zipWith
               (\i (n,v) -> (fromMaybe (T.pack $ '#':show i) n, v))
               ([0..] :: [Integer])
               (typemap output' otypes)
  return (fname,imap,omap)

processTheMessages :: [B.ByteString] -> PGConnection -> IORef Globals -> IO ()
processTheMessages messages conn g = do

  let changes = groupSimilarActions . join $ map (flatten . toAction . BL.fromStrict) messages

  unless (null messages) $
    debugM "processTheMessages" . unlines . map show $ messages

  case length messages of
   0 -> return ()
   1 -> infoM "processTheMessages" "1 message has arrived"
   n -> infoM "processTheMessages" $ show n ++ " messages have arrived"

  let conHost = flags_pghost
  let conPort = read flags_pgport
  let conUser = flags_pguser
  let conPass = flags_password
  let conDB = flags_database

  let dbConnectInfo = ConnectInfo { connectHost = conHost
                                 , connectPort = conPort
                                 , connectUser = conUser
                                 , connectPassword = conPass
                                 , connectDatabase = conDB
                                 }

  pool <- createPool (connect dbConnectInfo{connectDatabase="bloc22"}) close 5 3 5
  let strato = flags_stratourl
      vaultWrapper = flags_vaultwrapperurl
  stratoUrl <- parseBaseUrl strato
  vaultwrapperUrl <- parseBaseUrl vaultWrapper

  mgr <- newManager defaultManagerSettings

  --Set Flag on startup
  let deployFlag = BlockApps.Bloc22.Monad.Public

  let env = BlocEnv
            {
              urlStrato=stratoUrl   -- :: BaseUrl
            , urlVaultWrapper = vaultwrapperUrl
            , httpManager=mgr -- :: Manager
            , dbPool=pool     --  :: Pool Connection
            , logLevel=Error
            , deployMode= deployFlag   -- :: Severity
            , stateFetchLimit = flags_stateFetchLimit
            }

  enterBloc2 env $ do
    forM_ (map (filter hasContract) changes) $ \change -> do
      processedList <- forM (filter matters change) $ \row@Action{..} -> do
        liftIO . infoM "processTheMessages" . show $ T.concat ["--------\n", formatAction row]

        let md = fromMaybe Map.empty actionMetadata
        mcd <- getContractDetailsByCodeHash actionCodeHash
        mDetails <- withNothing mcd $ do
          fmap join . for (Map.lookup "src" md) $ \src -> do
            detailsMap <- compileContract src
            fmap join . for (Map.lookup "name" md) $ \name -> do
              traverse pure $ Map.lookup name detailsMap

        if isNothing mDetails
          then return . Left $ "No details found for code hash "
                            <> (T.pack $ show actionCodeHash)
                            <> " and no 'src' field found in actionMetadata"
          else do
            let Just (cmId,details) = mDetails
                strAbi = T.replace "\'" "\'\'" . decodeUtf8 . BL.toStrict . JSON.encode $ contractdetailsXabi details
                strName = T.replace "\"" "" $ contractdetailsName details
                cont = either error id . xAbiToContract $ contractdetailsXabi details
                chain = maybe "" (T.pack . flip showHex "" . unChainId) actionTxChainId
                cache = flip Map.lookup actionStorage
                updateGlobal m (k,f) = for_ (Map.lookup k =<< actionMetadata) $ \v -> do
                  let contracts = filter (not . T.null) $ T.splitOn "," v
                  forM_ contracts $ \c -> for_ (fmap (contractdetailsCodeHash . snd) $ Map.lookup c m) $ f g

            detailsMap <- compileContract $ contractdetailsSrc details -- won't actually recompile the contract
            mapM_ (updateGlobal detailsMap) $ [("history", addToHistoryList)
                                              ,("nohistory", removeFromHistoryList)
                                              ,("noindex", addToNoIndexList)
                                              ,("index", removeFromNoIndexList)
                                              ]

            (mInstance :: Maybe Int32) <- fmap listToMaybe . blocQuery $
              contractInstancesByCodeHash actionCodeHash actionAddress actionTxChainId
            when (isNothing mInstance) . void $ insertContractInstance cmId actionAddress actionTxChainId
            fetchLimit <- asks stateFetchLimit
            oldState <- fromMaybe (SVR.decodeValues fetchLimit (typeDefs cont) (mainStruct cont) (const 0) 0)
                          <$> getContractState g actionAddress actionTxChainId
            let newState = SVR.decodeCacheValues (typeDefs cont) (mainStruct cont) cache 0 oldState
                ret = Map.fromList newState
            setContractState g actionAddress actionTxChainId newState

            hist <- isHistoric g actionCodeHash
            let cData = if hist
                          then actionCallData
                          else maybeToList $ listToMaybe actionCallData
            fmap sequence . forM cData $ \CallData{..} -> do
              let ibytes = _input
                  obytes = fromMaybe B.empty _output
              (f',i,o) <- getFunctionCallValues cmId ibytes obytes
              let f = if T.null f'
                        then if actionType == Create
                              then "constructor"
                              else "fallback"
                        else f'

              pure . pure $ ProcessedContract -- the purest
                { address = actionAddress
                , codehash = actionCodeHash
                , abi = strAbi
                , contractName = strName
                , chain = chain
                , contractData = ret
                , blockHash = actionBlockHash
                , blockTimestamp = actionBlockTimestamp
                , blockNumber = actionBlockNumber
                , transactionHash = actionTxHash
                , transactionSender = actionTxSender
                , transactionFuncName = f
                , transactionInput = i
                , transactionOutput = o
                }

      forM_ (lefts processedList) $ liftIO . errorM "processTheMessages" . T.unpack
      when (not $ null processedList) . liftIO $ convertRet (join $ rights processedList) conn g
