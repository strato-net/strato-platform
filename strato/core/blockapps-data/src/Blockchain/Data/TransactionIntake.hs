{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- |
-- Module: Blockchain.Data.TransactionIntake
-- Description: Deterministic checks on a loose transaction's envelope.
--
-- A transaction whose envelope SolidVM cannot dispatch can only ever fail, yet
-- it is sequenced, gossiped, executed and indexed like any other. Every path
-- that accepts a loose transaction (HTTP submission, peer gossip, and the
-- sequencer where they converge) calls 'checkIntake' first, so the submitter
-- is told at once and the rest of the node never sees it.
--
-- Scope, deliberately narrow:
--
-- * It decides admission of loose transactions only. It is never applied to
--   the transactions of a block, so it does not change which blocks are valid.
-- * It never rewrites a transaction. A transaction is admitted exactly as it
--   was signed or it is rejected.
-- * It checks the envelope's form against the grammar SolidVM dispatches on.
--   It does not judge the content of a well-formed argument: a string
--   argument may hold any text.
-- * A nonce far ahead of the account's is not malformed and is not checked
--   here. That is a mempool resource question.
module Blockchain.Data.TransactionIntake
  ( IntakeRules (..),
    IntakeRejection (..),
    nodeIntakeRules,
    validateIntake,
    checkIntake,
    partitionIntake,
    intakeRejectionLabel,
    describeIntakeRejection,
    isCallName,
    isConstructorLabel,
    isNetworkLabel,
  )
where

import Blockchain.Data.TransactionDef (Transaction (..))
import Blockchain.EthConf (ethConf, networkConfig)
import qualified Blockchain.EthConf.Model as Conf
import Control.DeepSeq (NFData, force)
import Control.Exception (SomeAsyncException (..), SomeException, evaluate, fromException, throwIO, try)
import Control.Monad (unless, when, zipWithM_)
import Data.Char (isAlphaNum, isAscii)
import Data.Foldable (toList)
import Data.Maybe (catMaybes)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Word (Word8)
import GHC.Generics (Generic)
import SolidVM.Model.CodeCollection.Statement (Expression, ExpressionF (..))
import SolidVM.Solidity.Parse.Fast.Monad (commaSep, eof, identifier, parens)
import SolidVM.Solidity.Parse.Fast.Parser (parseArg, runRule)
import SolidVM.Solidity.Parse.Fast.Types (simpleType)
import SolidVM.Solidity.Parse.ParserTypes (initialParserState)

-- | What this node accepts on a transaction's envelope.
newtype IntakeRules = IntakeRules
  { -- | The node's own chain id. A transaction that names a chain must name this one.
    intakeChainId :: Integer
  }
  deriving (Eq, Show)

-- | The rules for the network this node is configured for.
nodeIntakeRules :: IntakeRules
nodeIntakeRules = IntakeRules (Conf.chainId (networkConfig ethConf))

-- | Why a transaction was not admitted. Carries no text taken from the
-- transaction, so it logs as one line and is a bounded metric label.
data IntakeRejection
  = -- | A transaction version this kind of transaction does not define.
    UnsupportedVersion Word8
  | -- | Signed for a different chain.
    WrongChainId
  | -- | A typed (EIP-1559) Ethereum transaction that names no chain.
    MissingChainId
  | -- | A @network@ field that is not a plain label.
    MalformedNetwork
  | -- | A function name that is neither an identifier nor @name(type, ...)@.
    MalformedFunctionName
  | -- | An external call naming a contract's constructor.
    ConstructorCall
  | -- | A contract name that is not an identifier.
    MalformedContractName
  | -- | The argument at this position is not a SolidVM literal.
    MalformedArgument Int
  | -- | The argument at this position passes a constructor name to a call.
    NestedConstructorCall Int
  | -- | The check itself failed. Treated as a rejection.
    IntakeCheckFailed
  deriving (Eq, Ord, Show, Generic, NFData)

-- | A stable short label, for metrics and structured logs.
intakeRejectionLabel :: IntakeRejection -> Text
intakeRejectionLabel = \case
  UnsupportedVersion _ -> "version"
  WrongChainId -> "chain_id"
  MissingChainId -> "chain_id_missing"
  MalformedNetwork -> "network"
  MalformedFunctionName -> "function_name"
  ConstructorCall -> "constructor_call"
  MalformedContractName -> "contract_name"
  MalformedArgument _ -> "argument"
  NestedConstructorCall _ -> "nested_constructor_call"
  IntakeCheckFailed -> "check_failed"

-- | A sentence for the submitter. Built only from fixed text and numbers.
describeIntakeRejection :: IntakeRejection -> Text
describeIntakeRejection = \case
  UnsupportedVersion n -> "transaction version " <> T.pack (show n) <> " is not supported for this kind of transaction"
  WrongChainId -> "the transaction is signed for a different chain"
  MissingChainId -> "a typed Ethereum transaction must name this chain"
  MalformedNetwork -> "the network field must be a short label of letters, digits, dots, hyphens and underscores"
  MalformedFunctionName -> "the function name must be an identifier, optionally followed by a parenthesized list of argument types"
  ConstructorCall -> "a constructor cannot be called on a deployed contract"
  MalformedContractName -> "the contract name must be an identifier"
  MalformedArgument i -> "argument " <> T.pack (show i) <> " is not a valid SolidVM literal"
  NestedConstructorCall i -> "argument " <> T.pack (show i) <> " names a constructor as a call target"
  IntakeCheckFailed -> "the transaction could not be checked"

-- | The pure check. Prefer 'checkIntake' on an intake path: it also contains
-- any failure of the check itself.
validateIntake :: IntakeRules -> Transaction -> Either IntakeRejection ()
validateIntake rules tx = case tx of
  MessageTX {} -> do
    version [0, 1]
    optionalChain
    networkLabel
    callName (funcName tx)
    arguments (args tx)
  ContractCreationTX {} -> do
    version [0, 1]
    optionalChain
    networkLabel
    unless (isIdentifier (contractName tx)) $ Left MalformedContractName
    arguments (args tx)
  EthereumTX {} -> do
    version [0, 2]
    -- The same rule the mempool already applies: a typed envelope names this
    -- chain, a legacy one may omit it.
    when (txVersion tx /= 0 && chainId tx == Nothing) $ Left MissingChainId
    optionalChain
  where
    version supported =
      unless (txVersion tx `elem` supported) $ Left (UnsupportedVersion (txVersion tx))
    optionalChain = case chainId tx of
      Nothing -> Right ()
      Just cid -> unless (cid == intakeChainId rules) $ Left WrongChainId
    networkLabel =
      unless (isNetworkLabel (network tx)) $ Left MalformedNetwork

-- | The signed @network@ field is a label the signer chooses. The node gives
-- it no meaning and compares it with nothing, and signers in use do not agree
-- on one value (@mercata@ from server-side signing, @STRATO@ from wallets,
-- others from deployment tools). So the rule is about form only: at most 64
-- ASCII letters, digits, dots, hyphens and underscores.
isNetworkLabel :: Text -> Bool
isNetworkLabel label = T.length label <= 64 && T.all plain label
  where
    plain c = isAscii c && (isAlphaNum c || c `elem` ("._-" :: String))

callName :: Text -> Either IntakeRejection ()
callName name
  | isConstructorLabel name = Left ConstructorCall
  | isCallName name = Right ()
  | otherwise = Left MalformedFunctionName

-- | The names a top-level call can resolve to a function or getter by:
--
-- * an identifier, exactly as the SolidVM lexer reads one, with nothing
--   around it;
-- * @fallback@ and @receive@, which a contract declares without @function@;
-- * @name(type, ...)@, which a proxy's fallback forwards to its logic
--   contract and SolidVM resolves by signature. Only the plain spelling is
--   accepted: no comments, no text after the closing parenthesis.
isCallName :: Text -> Bool
isCallName name = isIdentifier name || name `elem` ["fallback", "receive"] || isSignature name

-- | Exactly one identifier token and nothing else: no padding, no comment.
isIdentifier :: Text -> Bool
isIdentifier name = case runRule (identifier <* eof) initialParserState "" name of
  Right word -> word == name
  Left _ -> False

isSignature :: Text -> Bool
isSignature name =
  T.any (== '(') name
    && T.all plain name
    && T.strip name == name
    && not ("  " `T.isInfixOf` name)
    && case runRule signature initialParserState "" name of
      Right (word, _) -> word == T.takeWhile (/= '(') name
      Left _ -> False
  where
    signature = (,) <$> identifier <*> (parens (commaSep simpleType) <* eof)
    plain c = isAlphaNum c || c `elem` ("_$.(), " :: String)

-- | The same test SolidVM applies before it refuses the call: the text before
-- any parenthesis, ignoring surrounding white space, is the constructor's
-- label. So padded and signature-suffixed spellings are all recognized.
isConstructorLabel :: Text -> Bool
isConstructorLabel name = T.strip (T.takeWhile (/= '(') name) == "<constructor>"

arguments :: [Text] -> Either IntakeRejection ()
arguments = zipWithM_ argument [0 ..]
  where
    argument i text = case parseArg initialParserState "" text of
      Left _ -> Left (MalformedArgument i)
      Right expression
        | any (isConstructorLabel . T.pack) (stringLiterals expression) -> Left (NestedConstructorCall i)
        | otherwise -> Right ()

-- | The string literals of an argument, at any depth of array, tuple or object.
stringLiterals :: Expression -> [String]
stringLiterals = \case
  StringLiteral _ text -> [text]
  ArrayExpression _ items -> concatMap stringLiterals items
  TupleExpression _ items -> concatMap stringLiterals (catMaybes items)
  ObjectLiteral _ fields -> concatMap stringLiterals (toList fields)
  _ -> []

-- | The check as intake paths run it. The transaction is forced first, outside
-- the guard, so one that cannot be decoded fails exactly as it did before this
-- check existed. Any failure inside the check itself is a rejection.
checkIntake :: IntakeRules -> Transaction -> IO (Either IntakeRejection ())
checkIntake rules tx = do
  decoded <- evaluate (force tx)
  outcome <- try (evaluate (force (validateIntake rules decoded)))
  case outcome of
    Right verdict -> pure verdict
    Left (failure :: SomeException) -> case fromException failure of
      Just (SomeAsyncException _) -> throwIO failure
      Nothing -> pure (Left IntakeCheckFailed)

-- | Splits a batch into what is admitted, unchanged and in order, and what is
-- rejected with its reason.
partitionIntake :: IntakeRules -> (a -> Transaction) -> [a] -> IO ([a], [(a, IntakeRejection)])
partitionIntake rules transactionOf items = do
  verdicts <- mapM (checkIntake rules . transactionOf) items
  pure
    ( [item | (item, Right ()) <- zip items verdicts],
      [(item, reason) | (item, Left reason) <- zip items verdicts]
    )
