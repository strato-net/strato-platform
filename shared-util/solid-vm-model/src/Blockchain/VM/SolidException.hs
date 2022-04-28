{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
module Blockchain.VM.SolidException
  ( SolidException(..)
  , showSolidException
  , typeError
  , todo
  , indexOutOfBounds
  , checkArity
  , arityMismatch
  , internalError
  , invalidArguments
  , missingField
  , missingType
  , duplicateDefinition
  , parseError
  , require
  , assert
  , unknownFunction
  , unknownConstant
  , unknownVariable
  , unknownStatement
  , divideByZero
  , missingCodeCollection
  , inaccessibleChain
  , invalidWrite
  ) where

import Control.DeepSeq
import Control.Exception (throw, throwIO, Exception)
import Control.Monad (unless, when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Aeson (ToJSON, FromJSON)
import GHC.Generics
import Text.Printf (printf)

data SolidException = TypeError String String
                    | InternalError String String
                    | InvalidArguments String String
                    | InvalidPragma String String
                    | IndexOutOfBounds String String
                    | TODO String String
                    | MissingField String String
                    | MissingType String String
                    | DuplicateDefinition String String
                    | ArityMismatch String Int Int
                    | ParseError String String
                    | Require (Maybe String)
                    | Assert
                    | UnknownFunction String String
                    | UnknownConstant String String
                    | UnknownVariable String String
                    | UnknownStatement String String
                    | DivideByZero String 
                    | MissingCodeCollection String String
                    | InaccessibleChain String String
                    | InvalidWrite String String
                    deriving (Eq, Exception, Generic, NFData, ToJSON, FromJSON)

instance Show SolidException where
  show = showSolidException

showSolidException :: SolidException -> String
showSolidException (ArityMismatch m got want) = printf "arity mismatch: %s: got %d, want %d" m got want
showSolidException (InternalError m v) = printf "internal error: %s: %s" m v
showSolidException (InvalidArguments m v) = printf "invalid arguments: %s: %s" m v
showSolidException (InvalidPragma m v) = printf "invalid pragma: %s:" m v
showSolidException (IndexOutOfBounds a b)= printf "index out of bounds: %s: %s" a b
showSolidException (MissingField m v) = printf "missing field: %s: %s" m v
showSolidException (MissingType m v) = printf "missing type: %s: %s" m v
showSolidException (DuplicateDefinition m v) = printf "duplicate definition: %s: %s" m v
showSolidException (ParseError m v) = printf "parse error: %s: %s" m v
showSolidException (Require Nothing) = printf "solidity require failed"
showSolidException (Require (Just m)) = printf "solidity require failed: %s" m
showSolidException Assert = printf "solidity assert failed"
showSolidException (TODO m v) = printf "Unimplemented feature in SolidVM: %s: %s" m v
showSolidException (TypeError a b) = printf "type error: %s: %s" a b
showSolidException (UnknownConstant a b) = printf "unknown constant: %s: %s" a b
showSolidException (UnknownFunction a b) = printf "unknown function: %s: %s" a b
showSolidException (UnknownVariable a b) = printf "unknown variable: %s: %s" a b
showSolidException (UnknownStatement a b) = printf "unknown statement: %s: %s" a b
showSolidException (DivideByZero a) = printf "divide by zero error: %s" a
showSolidException (MissingCodeCollection a b) = printf "missing code collection: %s: %s" a b
showSolidException (InaccessibleChain a b) = printf "inaccessible chain: %s: %s" a b
showSolidException (InvalidWrite a b) = printf "invalid write: %s: %s" a b

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

missingType :: (Show v) => String -> v -> a
missingType = toThrower MissingType

duplicateDefinition :: (Show v) => String -> v -> a
duplicateDefinition = toThrower DuplicateDefinition

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

missingCodeCollection :: (Show v) => String -> v -> a
missingCodeCollection = toThrower MissingCodeCollection

inaccessibleChain :: (Show v) => String -> v -> a
inaccessibleChain = toThrower InaccessibleChain

invalidWrite :: (Show v) => String -> v -> a
invalidWrite = toThrower InvalidWrite
