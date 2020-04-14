module Blockchain.VM.SolidException
  ( SolidException(..)
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
  ) where

import Control.DeepSeq
import Control.Exception (throw, throwIO, Exception)
import Control.Monad (unless, when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import GHC.Generics
import Text.Printf (printf)

data SolidException = TypeError String String
                    | InternalError String String
                    | InvalidArguments String String
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
                    deriving (Eq, Exception, Generic, NFData)

instance Show SolidException where
  show (ArityMismatch m got want) = printf "arity mismatch: %s: got %d, want %d" m got want
  show (InternalError m v) = printf "internal error: %s: %s" m v
  show (InvalidArguments m v) = printf "invalid arguments: %s: %s" m v
  show (IndexOutOfBounds a b)= printf "index out of bounds: %s: %s" a b
  show (MissingField m v) = printf "missing field: %s: %s" m v
  show (MissingType m v) = printf "missing type: %s: %s" m v
  show (DuplicateDefinition m v) = printf "duplicate definition: %s: %s" m v
  show (ParseError m v) = printf "parse error: %s: %s" m v
  show (Require Nothing) = printf "solidity require failed"
  show (Require (Just m)) = printf "solidity require failed: %s" m
  show Assert = printf "solidity assert failed"
  show (TODO m v) = printf "Unimplemented feature in SolidVM: %s: %s" m v
  show (TypeError a b) = printf "type error: %s: %s" a b
  show (UnknownConstant a b) = printf "unknown constant: %s: %s" a b
  show (UnknownFunction a b) = printf "unknown function: %s: %s" a b
  show (UnknownVariable a b) = printf "unknown variable: %s: %s" a b
  show (UnknownStatement a b) = printf "unknown statement: %s: %s" a b
  show (DivideByZero a) = printf "divide by zero error: %s" a

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
