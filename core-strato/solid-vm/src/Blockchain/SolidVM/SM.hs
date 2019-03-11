{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeSynonymInstances  #-}


--{-# OPTIONS -fno-warn-unused-top-binds  #-}

module Blockchain.SolidVM.SM (
  CallInfo(..),
  SState(..),
  Environment(..),
  SM,
  runSM,
  getCurrentAddress,
  addCallInfo,
  popCallInfo,
  getCurrentCallInfo,
  getCurrentContract,
  getCurrentCodeCollection,
  getEnv,
  getVariableOfName,
  getFunctionOfName,
  getTypeOfName,
  getValueType
  ) where

import           Control.Applicative ((<|>))
import           Control.Lens
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import           Data.Bifunctor (first)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Maybe
import qualified Data.Text as T
import           Data.Text.Encoding(encodeUtf8,decodeUtf8)

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs (BlockData(..))
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.Value
import           Blockchain.VMContext

import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Type as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

import CodeCollection








data CallInfo =
  CallInfo {
    currentAddress :: Address,
    currentContract :: Contract,
    codeCollection :: CodeCollection,
    localVariables :: Map String (Xabi.Type, Variable)
    }

{-
BlockData
    parentHash SHA
    unclesHash SHA
    coinbase Address
    stateRoot StateRoot
    transactionsRoot StateRoot
    receiptsRoot StateRoot
    logBloom BS.ByteString
    difficulty Integer sqltype=numeric(1000,0)
    number Integer sqltype=numeric(1000,0)
    gasLimit Integer sqltype=numeric(1000,0)
    gasUsed Integer sqltype=numeric(1000,0)
    timestamp UTCTime
    extraData BS.ByteString
    nonce Word64
    mixHash SHA
    deriving Eq Read Show Generic
-}

data Environment =
  Environment {
    sender :: Address,
    origin :: Address,
    blockHeader :: BlockData
    }

data SState =
  SState {
    env :: Environment,
    callStack :: [CallInfo],
    codeDB                 :: CodeDB,
    hashDB                 :: HashDB,
    stateDB                :: MP.MPDB,
    addressStateTxDBMap    :: M.Map Address AddressStateModification,
    addressStateBlockDBMap :: M.Map Address AddressStateModification,
    storageTxMap           :: M.Map (Address, B.ByteString) B.ByteString,
    storageBlockMap        :: M.Map (Address, B.ByteString) B.ByteString
  }

type SM = StateT SState (ResourceT IO)

instance HasMemAddressStateDB SM where
  getAddressStateTxDBMap = addressStateTxDBMap <$> get
  putAddressStateTxDBMap theMap = do
    sstate <- get
    put $ sstate{addressStateTxDBMap=theMap}
  getAddressStateBlockDBMap = addressStateBlockDBMap <$> get
  putAddressStateBlockDBMap theMap = do
    sstate <- get
    put $ sstate{addressStateBlockDBMap=theMap}

instance HasRawStorageDB SM where
  getRawStorageTxDB = do
    cxt <- get
    return (MP.ldb $ stateDB cxt, --storage and states use the same database!
            storageTxMap cxt)
  putRawStorageTxMap theMap = do
    cxt <- get
    put cxt{storageTxMap=theMap}
  getRawStorageBlockDB = do
    cxt <- get
    return (MP.ldb $ stateDB cxt, --storage and states use the same database!
            storageBlockMap cxt)
  putRawStorageBlockMap theMap = do
    cxt <- get
    put cxt{storageBlockMap=theMap}

instance HasStateDB SM where
  getStateDB = stateDB <$> get
  setStateDBStateRoot sr = do
    cxt <- get
    put cxt{stateDB=(stateDB cxt){MP.stateRoot=sr}}

instance HasHashDB SM where
  getHashDB = hashDB <$> get

instance HasCodeDB SM where
  getCodeDB = codeDB <$> get

runSM :: Environment -> SM a -> ContextM a
runSM env f = do
  vmcontext <- get

  let startingState =
        SState {
        env = env,
        callStack = [],
        codeDB = contextCodeDB vmcontext,
        hashDB = contextHashDB vmcontext,
        stateDB = contextStateDB vmcontext,
        addressStateTxDBMap = contextAddressStateTxDBMap vmcontext,
        addressStateBlockDBMap = contextAddressStateBlockDBMap vmcontext,
        storageTxMap = contextStorageTxMap vmcontext,
        storageBlockMap = contextStorageBlockMap vmcontext
        }

  (value, sstateAfter) <- liftIO $ runResourceT $ runStateT f startingState

  vmcontext' <- get
  put vmcontext'{
    contextAddressStateTxDBMap = addressStateTxDBMap sstateAfter,
    contextAddressStateBlockDBMap = addressStateBlockDBMap sstateAfter,
    contextStorageTxMap = storageTxMap sstateAfter,
    contextStorageBlockMap = storageBlockMap sstateAfter
    }
  setStateDBStateRoot $ MP.stateRoot $ stateDB sstateAfter
  return value

getEnv :: SM Environment
getEnv = do
  fmap env get


toMaybe :: Bool -> a -> Maybe a
toMaybe True x = Just x
toMaybe False _ = Nothing

getFunctionOfName :: String -> SM Function
getFunctionOfName name = do
  currentCallInfo <- getCurrentCallInfo
  let maybeContractFunction = fmap (FFunction) $ M.lookup name
                            $ currentContract currentCallInfo^.functions

      maybeBuiltinFunction = toMaybe (name `elem` ["uint", "keccak256", "require", "revert",
                                                   "assert", "sha3", "sha256", "ecrecover",
                                                   "addmod", "mulmod", "selfdestruct", "suicide"])
                           $ FBuiltinFunction name Nothing

      maybeEnum = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.enums))
                $ FEnum name

      maybeStructDef = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.structs))
                     $ FStructDef name
  return $ fromMaybe (unknownFunction "getFunctionOfName" name) . foldr1 (<|>) $
           [maybeContractFunction, maybeBuiltinFunction, maybeEnum, maybeStructDef]

getVariableOfName :: String -> SM Variable
getVariableOfName name = do
  sstate <- get

  let currentCallInfo =
        case callStack sstate of
          [] -> internalError "getVariableValue called with an empty stack" name
          (x:_) -> x
      vars = localVariables currentCallInfo
      maybeLocalValue = toMaybe (name `M.member` vars) $ StorageItem [MS.Field $ BC.pack name]

      maybeContractFunction :: Maybe Variable
      maybeContractFunction = fmap (Constant . SFunction) $ M.lookup name $ currentContract currentCallInfo^.functions

      maybeBuiltinFunction :: Maybe Variable
      maybeBuiltinFunction = toMaybe (name `elem` ["uint", "keccak256", "require", "revert", "assert", "sha3", "sha256", "ecrecover", "addmod", "mulmod", "selfdestruct", "suicide"]) $
        Constant $ SBuiltinFunction name Nothing

      maybeBuiltinVariable :: Maybe Variable
      maybeBuiltinVariable = toMaybe (name `elem` ["msg", "block", "tx"]) $
        Constant $ SBuiltinVariable name

      maybeEnum :: Maybe Variable
      maybeEnum = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.enums)) $
        Constant $ SEnum name

      maybeStructDef :: Maybe Variable
      maybeStructDef = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.structs)) $
        Constant $ SStructDef name

      maybeContract :: Maybe Variable
      maybeContract = toMaybe (name `elem` M.keys (codeCollection currentCallInfo^.contracts)) $
        Constant $ SContractDef name

      maybeStorageItem :: Maybe Variable
      maybeStorageItem =
        -- TODO(tim): This might just be restricted to a field name
        if name `elem` M.keys (currentContract currentCallInfo^.storageDefs)
        then Just $ StorageItem [MS.Field $ BC.pack name]
        else Nothing

      maybeThis :: Maybe Variable
      maybeThis = toMaybe (name == "this") . Constant . SAddress . currentAddress $ currentCallInfo



--        M.lookup (currentAddress currentCallInfo) (accounts sstate) >>= M.lookup name . storage


  --TODO- Add the constant lookup properly
  {-
  maybeConstantValue <- do
--    M.lookup (currentAddress currentCallInfo) (accounts sstate) >>= M.lookup name . constants
    liftIO $ putStrLn $ " @@@@@@@@@@@@@@@@@@@ available constants: " ++ show (M.keys $ currentContract currentCallInfo^.constants)
    case M.lookup name $ currentContract currentCallInfo^.constants of
      Nothing -> return Nothing
      Just (Xabi.ConstantDecl _ _ e) -> do
        let val = constExpToVar e
        return $ Just $ Constant $ val
-}

  return . fromMaybe (unknownVariable "getVariableOfName" name) . foldr1 (<|>) $
      [ maybeLocalValue
      , maybeStorageItem
      , maybeContractFunction
      , maybeBuiltinFunction
      , maybeBuiltinVariable
      , maybeEnum
      , maybeStructDef
      , maybeContract
      , maybeThis
      , unknownVariable "getVariableOfName" name
      ]


getCurrentCallInfo :: SM CallInfo
getCurrentCallInfo = do
  sstate <- get
  case callStack sstate of
    [] -> internalError "getCurrentCallInfo called with an empty stack" ()
    (currentCallInfo:_) -> return currentCallInfo


getTypeOfName :: String -> SM Typo
getTypeOfName s = do
  let lookInContract :: Contract -> [Typo]
      lookInContract (Contract{..}) = catMaybes
        [ fmap StructTypo (M.lookup s _structs)
        , fmap EnumTypo (M.lookup s _enums)
        ]
  CodeCollection ccs <- fmap codeCollection getCurrentCallInfo
  let ctrs = map ContractTypo $ M.keys ccs
  case concatMap lookInContract ccs ++ ctrs of
    [] -> internalError "getTypeOfName" s
    (typo:_) -> return typo

{-
  c <- fmap (currentContract . head . callStack) get
  let contractVariables = undefined
      theFunction =
        flip fromMaybe (M.lookup name $ c^.functions)
        $ flip fromMaybe (M.lookup name contractVariables)
        $ error $ "No variable named " ++ name
      Just funcStatements = funcContents theFunction

  runStatements funcStatements
-}


addCallInfo :: Address -> Contract -> CodeCollection -> Map String (Xabi.Type, Variable) -> SM ()
addCallInfo a c cc initialLocalVariables = do
  sstate <- get

  let newCallInfo =
        CallInfo {
          currentAddress=a,
          currentContract=c,
          codeCollection=cc,
          localVariables=initialLocalVariables
        }

  put sstate{callStack = newCallInfo:callStack sstate}

popCallInfo :: SM ()
popCallInfo = do
  sstate <- get
  case callStack sstate of
    [] -> internalError "popCallInfo was called on an already empty stack" ()
    (_:rest) -> put sstate{callStack = rest}


getCurrentContract :: SM Contract
getCurrentContract = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ currentContract currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()

getCurrentAddress :: SM Address
getCurrentAddress = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ currentAddress currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()

getCurrentCodeCollection :: SM CodeCollection
getCurrentCodeCollection = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ codeCollection currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()

hintFromType :: Xabi.Type -> SM BasicType
hintFromType = \case
 Xabi.Address{} -> return TAddress
 Xabi.Bool{} -> return TBool
 Xabi.Bytes{} -> return TString
 Xabi.Int{} -> return TInteger
 Xabi.String{} -> return TString
 Xabi.Label s -> do
   t' <- getTypeOfName s
   case t' of
     ContractTypo{} -> return $ TContract s
     EnumTypo{} -> return $ TEnumVal s
     StructTypo fs -> do
       let upgrade :: (T.Text, Xabi.FieldType) -> SM (B.ByteString , BasicType)
           upgrade = mapM (hintFromType . Xabi.fieldTypeType) . first encodeUtf8
       TStruct s <$> mapM upgrade fs
 tt'' -> todo "hintFromType" tt''

getValueType :: MS.StoragePath -> SM BasicType
getValueType [] = internalError "getValueType" ([]::MS.StoragePath)
getValueType (MS.Field field:rest) = do
  ctract <- getCurrentContract
  currentCallInfo <- getCurrentCallInfo
  let localDecls = localVariables currentCallInfo
  let storageDecls = ctract ^. storageDefs
  let allTypes = (fmap Xabi.varType storageDecls `M.union` fmap fst localDecls)
  case M.lookup (BC.unpack field) allTypes of
    Nothing -> return $ Todo $ "getValueType/unknown storage reference:" ++ show field
    Just v -> loop rest v
 where loop :: MS.StoragePath -> Xabi.Type -> SM BasicType
       loop [] = hintFromType
       loop [x] = \case
         Xabi.Mapping{Xabi.value=v} -> case x of
          MS.MapIndex{} -> hintFromType v
          _ -> typeError "map index" x
         Xabi.Array{Xabi.entry=v} -> case x of
          MS.Field "length" -> return TInteger
          MS.ArrayIndex{} -> hintFromType v
          _ -> internalError "array path piece" x
         Xabi.Label s -> do
           t' <- getTypeOfName s
           case (x, t') of
             (MS.Field n, StructTypo fs) -> do
               let mt'' = lookup (decodeUtf8 n) fs
               case mt'' of
                Just t'' -> hintFromType $ Xabi.fieldTypeType t''
                Nothing -> error $ "field not present in struct definition: " ++ show (n, fs)
             (_, StructTypo{}) -> typeError "non field access to struct" x
             (_, ContractTypo{}) -> todo "getValueType/contract access" t'
             (_, EnumTypo{}) -> todo "getValueType/enum acess" t'
         t'' -> todo "atomic type does not have value type" t''
       loop (_:rs) = \case
         Xabi.Mapping{Xabi.value=t'} -> loop rs t'
         Xabi.Array{Xabi.entry=t'} -> loop rs t'
         t -> error $ "not an indexable type B: " ++ show t
getValueType xs = internalError "getValueType started from non-field" xs
