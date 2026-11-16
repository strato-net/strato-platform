{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.VM.SolidException
  ( SolidException (..),
    showSolidException,
    checkArity,
    require,
    assert
  )
where

import Control.DeepSeq
import Control.Exception (Exception (displayException), throwIO)
import Control.Monad (unless, when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.List (intercalate)
import qualified Data.Text as T
import GHC.Generics
import qualified SolidVM.Model.Storable as B
import Text.Printf (printf)

data SolidException
  = TypeError String String
  | InternalError String
  | ArithmeticException String String
  | InvalidArguments String String
  | IndexOutOfBounds String String
  | UnsupportedFeature String String
  | MissingField String String
  | RevertError String String
  | CustomError String String [B.BasicValue]
  | MissingType String String
  | DuplicateDefinition String String
  | DuplicateContract String
  | ArityMismatch String Int Int
  | ParseError String String
  | Require (Maybe String)
  | ModifierError String String
  | Assert
  | UnknownFunction String String
  | UnknownConstant String String
  | UnknownVariable String String
  | UnknownStatement String String
  | DivideByZero String
  | MissingCodeCollection String String
  | InaccessibleChain String String
  | InvalidChain String String
  | InvalidWrite String String
  | MalformedData String String
  | TooMuchGas Integer Integer
  | PaymentError Integer (String, Integer)
  | ReservedWordError String String
  | ImmutableError String String
  | FailedToAttainRunTimCode String String
  | TooManyResultsError String Int
  | TooManyCooks Int Int
  | GeneralMetaProgrammingError String String
  | OldForeignPragmaError String String
  | UserDefinedError String String
  deriving (Eq, Generic, NFData)

instance Exception SolidException where
  displayException (RevertError "REVERT" message) = if null message then "transaction reverted" else message
  displayException (RevertError context message) = printf "revert: %s: %s" context message
  displayException (CustomError _ name args) = name ++ "(" ++ intercalate ", " (map (T.unpack . B.formatBasicValueForSQL) args) ++ ")"
  displayException exception = showSolidException exception

instance Show SolidException where
  show = showSolidException

showSolidException :: SolidException -> String
showSolidException (ArityMismatch m got want) = printf "arity mismatch: %s: got %d, want %d" m got want
showSolidException (InternalError message) = "internal error: " ++ message
showSolidException (ArithmeticException a b) = printf "integer out of bounds: %s: %s" a b
showSolidException (InvalidArguments m v) = printf "invalid arguments: %s: %s" m v
showSolidException (IndexOutOfBounds a b) = printf "index out of bounds: %s: %s" a b
showSolidException (MissingField m v) = printf "missing field: %s: %s" m v
showSolidException (MissingType m v) = printf "missing type: %s: %s" m v
showSolidException (RevertError m v) = printf "revert: %s %s:" m v
showSolidException (DuplicateDefinition m v) = printf "duplicate definition: %s: %s" m v
showSolidException (DuplicateContract a) = printf "duplicate salted contract address: %s" a
showSolidException (ParseError m v) = printf "parse error: %s: %s" m v
showSolidException (ModifierError m v) = printf "modifier error: %s: %s" m v
showSolidException (Require Nothing) = printf "solidity require failed"
showSolidException (Require (Just m)) = printf "solidity require failed: %s" m
showSolidException Assert = printf "solidity assert failed"
showSolidException (CustomError m v p) = printf "custom user error: %s %s %s" m v $ show p
showSolidException (UnsupportedFeature m v) = printf "unsupported SolidVM feature: %s: %s" m v
showSolidException (TypeError a b) = printf "type error: %s: %s" a b
showSolidException (UnknownConstant a b) = printf "unknown constant: %s: %s" a b
showSolidException (UnknownFunction a b) = printf "unknown function: %s: %s" a b
showSolidException (UnknownVariable a b) = printf "unknown variable: %s: %s" a b
showSolidException (UnknownStatement a b) = printf "unknown statement: %s: %s" a b
showSolidException (DivideByZero a) = printf "divide by zero error: %s" a
showSolidException (MissingCodeCollection a b) = printf "missing code collection: %s: %s" a b
showSolidException (InvalidChain a b) = printf "Chain is invalid for address: %s, likely problem with %s metaprogramming" a b
showSolidException (InaccessibleChain a b) = printf "inaccessible chain: %s: %s" a b
showSolidException (InvalidWrite a b) = printf "invalid write: %s: %s" a b
showSolidException (MalformedData a b) = printf "Malformed data: %s: %s" a b
showSolidException (TooMuchGas a b) = printf "You've run out of gas, the original alotment was %d, but the current gasInfo was: %d" a b
showSolidException (PaymentError a (addr, b)) = printf "There was an error sending %d wei to the following address with a balance of %d: %s" a b addr
showSolidException (ReservedWordError a b) = printf "%s is a reserved word in version %s and up." b a
showSolidException (ImmutableError a b) = printf "%s is an immutable variable in line '%s'" a b
showSolidException (FailedToAttainRunTimCode a b) = printf "%s failed to aquire run time code '%s'" a b
showSolidException (TooManyResultsError a b) = printf "Too many results returned from input %s: found %d entries (should be 1)." a b
showSolidException (TooManyCooks a b) = printf "Too many arguments were given, expected %d argument/s, but received %d arguments." a b
showSolidException (GeneralMetaProgrammingError a b) = printf "There was a problem with the use of '%s', and the given term/s %s" a b
showSolidException (OldForeignPragmaError a b) = printf "The foreign contract (%s) being called needs an newer pragma in order to use metaprogramming. Foreign contract running: %s" a b
showSolidException (UserDefinedError a b) = printf "%s is an user defined error in line '%s'" a b

checkArity :: (MonadIO m) => String -> Int -> Int -> m ()
checkArity msg got want = when (got /= want) . liftIO . throwIO $ ArityMismatch msg got want

require :: MonadIO m => Bool -> Maybe String -> m ()
require c = unless c . liftIO . throwIO . Require

assert :: MonadIO m => Bool -> m ()
assert c = unless c . liftIO $ throwIO Assert
