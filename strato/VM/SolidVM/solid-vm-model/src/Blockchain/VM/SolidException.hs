{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.VM.SolidException
  ( SolidException (..),
    showSolidException,
    typeError,
    todo,
    indexOutOfBounds,
    checkArity,
    arityMismatch,
    internalError,
    invalidArguments,
    missingField,
    customError,
    missingType,
    duplicateDefinition,
    duplicateContract,
    parseError,
    require,
    assert,
    modifierError,
    unknownFunction,
    unknownConstant,
    unknownVariable,
    unknownStatement,
    divideByZero,
    missingCodeCollection,
    inaccessibleChain,
    invalidChain,
    invalidWrite,
    invalidCertificate,
    malformedData,
    tooMuchGas,
    paymentError,
    reservedWordError,
    revertError,
    immutableError,
    getRunTimeCodeError,
    tooManyResultsError,
    tooManyCooks,
    generalMetaProgrammingError,
    oldForeignPragmaError,
    userDefinedError,
    missingCertificate,
  )
where

import Control.DeepSeq
import Control.Exception (Exception, throw, throwIO)
import Control.Monad (unless, when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import GHC.Generics
import qualified SolidVM.Model.Storable as B
import Text.Printf (printf)

data SolidException
  = TypeError String String
  | InternalError String String
  | InvalidArguments String String
  | IndexOutOfBounds String String
  | TODO String String
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
  | InvalidCertificate String String
  | MalformedData String String
  | TooMuchGas Integer Integer
  | PaymentError String String
  | ReservedWordError String String
  | ImmutableError String String
  | FailedToAttainRunTimCode String String
  | TooManyResultsError String Int
  | TooManyCooks Int Int
  | GeneralMetaProgrammingError String String
  | OldForeignPragmaError String String
  | UserDefinedError String String
  | MissingCertificate String String
  deriving (Eq, Exception, Generic, NFData)

instance Show SolidException where
  show = showSolidException

showSolidException :: SolidException -> String
showSolidException (ArityMismatch m got want) = printf "arity mismatch: %s: got %d, want %d" m got want
showSolidException (InternalError m v) = printf "internal error: %s: %s" m v
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
showSolidException (TODO m v) = printf "Unimplemented feature in SolidVM: %s: %s" m v
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
showSolidException (InvalidCertificate a b) = printf "invalid certificate: %s: %s" a b
showSolidException (MalformedData a b) = printf "Malformed data: %s: %s" a b
showSolidException (TooMuchGas a b) = printf "You've run out of gas, the original alotment was %d, but the current gasInfo was: %d" a b
showSolidException (PaymentError a b) = printf "There was an error sending %s wei to the following address: %s" a b
showSolidException (ReservedWordError a b) = printf "%s is a reserved word in version %s and up." b a
showSolidException (ImmutableError a b) = printf "%s is an immutable variable in line '%s'" a b
showSolidException (FailedToAttainRunTimCode a b) = printf "%s failed to aquire run time code '%s'" a b
showSolidException (TooManyResultsError a b) = printf "Too many results returned from input %s: found %d entries (should be 1)." a b
showSolidException (TooManyCooks a b) = printf "Too many arguments were given, expected %d argument/s, but received %d arguments." a b
showSolidException (GeneralMetaProgrammingError a b) = printf "There was a problem with the use of '%s', and the given term/s %s" a b
showSolidException (OldForeignPragmaError a b) = printf "The foreign contract (%s) being called needs an newer pragma in order to use metaprogramming. Foreign contract running: %s" a b
showSolidException (UserDefinedError a b) = printf "%s is an user defined error in line '%s'" a b
showSolidException (MissingCertificate a b) = printf "Sender does not have a registered certificate: %s %s" a b

toThrower :: (Show v) => (String -> String -> SolidException) -> String -> v -> a
toThrower cont msg = throw . cont msg . show

typeError :: (Show v) => String -> v -> a
typeError = toThrower TypeError

todo :: (Show v) => String -> v -> a
todo = toThrower TODO

internalError :: (Show v) => String -> v -> a
internalError = toThrower InternalError

invalidArguments :: (Show v) => String -> v -> a
invalidArguments = toThrower InvalidArguments

indexOutOfBounds :: (Show v) => String -> v -> a
indexOutOfBounds = toThrower IndexOutOfBounds

missingField :: (Show v) => String -> v -> a
missingField = toThrower MissingField

revertError :: (Show v) => String -> v -> a
revertError = toThrower RevertError

customError :: String -> String -> [B.BasicValue] -> a
customError msg nm vals = throw $ CustomError msg nm vals

missingType :: (Show v) => String -> v -> a
missingType = toThrower MissingType

duplicateDefinition :: (Show v) => String -> v -> a
duplicateDefinition = toThrower DuplicateDefinition

duplicateContract :: (Show v) => v -> a
duplicateContract x = throw $ DuplicateContract (show x)

checkArity :: (MonadIO m) => String -> Int -> Int -> m ()
checkArity msg got want = when (got /= want) . liftIO . throwIO $ ArityMismatch msg got want

arityMismatch :: String -> Int -> Int -> a
arityMismatch msg got want = throw $ ArityMismatch msg got want

parseError :: (Show v) => String -> v -> a
parseError = toThrower ParseError

require :: MonadIO m => Bool -> Maybe String -> m ()
require c = unless c . liftIO . throwIO . Require

assert :: MonadIO m => Bool -> m ()
assert c = unless c . liftIO $ throwIO Assert

unknownFunction :: (Show v) => String -> v -> a
unknownFunction = toThrower UnknownFunction

unknownConstant :: (Show v) => String -> v -> a
unknownConstant = toThrower UnknownConstant

unknownVariable :: (Show v) => String -> v -> a
unknownVariable = toThrower UnknownVariable

unknownStatement :: (Show v) => String -> v -> a
unknownStatement = toThrower UnknownStatement

divideByZero :: (Show v) => v -> a
divideByZero x = throw $ DivideByZero (show x)

modifierError :: (Show v) => String -> v -> a
modifierError = toThrower ModifierError

missingCodeCollection :: (Show v) => String -> v -> a
missingCodeCollection = toThrower MissingCodeCollection

inaccessibleChain :: (Show v) => String -> v -> a
inaccessibleChain = toThrower InaccessibleChain

invalidChain :: (Show v) => String -> v -> a
invalidChain = toThrower InvalidChain

invalidWrite :: (Show v) => String -> v -> a
invalidWrite = toThrower InvalidWrite

invalidCertificate :: (Show v) => String -> v -> a
invalidCertificate = toThrower InvalidCertificate

malformedData :: (Show v) => String -> v -> a
malformedData = toThrower MalformedData

tooMuchGas :: Integer -> Integer -> a
tooMuchGas limit actual = throw $ TooMuchGas limit actual

paymentError :: (Show v) => String -> v -> a
paymentError = toThrower PaymentError

reservedWordError :: (Show v) => String -> v -> a
reservedWordError = toThrower ReservedWordError

immutableError :: (Show v) => String -> v -> a
immutableError = toThrower ImmutableError

getRunTimeCodeError :: (Show v) => String -> v -> a
getRunTimeCodeError = toThrower FailedToAttainRunTimCode

tooManyResultsError :: String -> Int -> a
tooManyResultsError word got = throw $ TooManyResultsError word got

tooManyCooks :: Int -> Int -> a
tooManyCooks expected got = throw $ TooManyCooks expected got

generalMetaProgrammingError :: (Show v) => String -> v -> a
generalMetaProgrammingError = toThrower GeneralMetaProgrammingError

oldForeignPragmaError :: (Show v) => String -> v -> a
oldForeignPragmaError = toThrower OldForeignPragmaError

userDefinedError :: (Show v) => String -> v -> a
userDefinedError = toThrower UserDefinedError

missingCertificate :: (Show v) => String -> v -> a
missingCertificate = toThrower MissingCertificate
