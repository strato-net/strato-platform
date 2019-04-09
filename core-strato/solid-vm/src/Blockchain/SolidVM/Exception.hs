module Blockchain.SolidVM.Exception
  ( SolidException(..)
  , typeError
  , todo
  , checkArity
  , arityMismatch
  , internalError
  , missingField
  , missingType
  , require
  , unknownFunction
  , unknownConstant
  , unknownVariable
  ) where

import Control.Exception (throw, throwIO, Exception)
import Control.Monad (unless, when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Text.Printf (printf)

data SolidException = TypeError String String
                    | InternalError String String
                    | TODO String String
                    | MissingField String String
                    | MissingType String String
                    | ArityMismatch String Int Int
                    | Require (Maybe String)
                    | UnknownFunction String String
                    | UnknownConstant String String
                    | UnknownVariable String String
                    deriving (Eq, Exception)

instance Show SolidException where
  show (ArityMismatch m got want) = printf "arity mismatch: %s: got %d, want %d" m got want
  show (InternalError m v) = printf "internal error: %s: %s" m v
  show (MissingField m v) = printf "missing field: %s: %s" m v
  show (MissingType m v) = printf "missing type: %s: %s" m v
  show (Require Nothing) = printf "solidity require failed"
  show (Require (Just m)) = printf "solidity require failed: %s" m
  show (TODO m v) = printf "TODO: %s: %s" m v
  show (TypeError a b) = printf "type error: %s: %s" a b
  show (UnknownConstant a b) = printf "unknown constant: %s: %s" a b
  show (UnknownFunction a b) = printf "unknown function: %s: %s" a b
  show (UnknownVariable a b) = printf "unknown variable: %s: %s" a b

toThrower :: (Show v) => (String -> String -> SolidException) -> String -> v -> a
toThrower cont msg = throw . cont msg . show

typeError :: (Show v) => String -> v -> a
typeError = toThrower TypeError

todo :: (Show v) => String -> v -> a
todo = toThrower TODO

internalError :: (Show v) => String -> v -> a
internalError = toThrower InternalError

missingField :: (Show v) => String -> v -> a
missingField = toThrower MissingField

missingType :: (Show v) => String -> v -> a
missingType = toThrower MissingType

checkArity :: (MonadIO m) => String -> Int -> Int -> m ()
checkArity msg got want = when (got /= want) . liftIO . throwIO $ ArityMismatch msg got want

arityMismatch :: String -> Int -> Int -> a
arityMismatch msg got want = throw $ ArityMismatch msg got want

require :: MonadIO m => Bool -> Maybe String -> m ()
require c = unless c . liftIO . throwIO . Require

unknownFunction :: (Show v) => String -> v -> a
unknownFunction = toThrower UnknownFunction

unknownConstant :: (Show v) => String -> v -> a
unknownConstant = toThrower UnknownConstant

unknownVariable :: (Show v) => String -> v -> a
unknownVariable = toThrower UnknownVariable
