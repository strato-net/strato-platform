
module Network.KafkaExt where


import           Control.Applicative
import           Control.Exception           (IOException)
import           Control.Exception.Lifted    (catch)
import           Control.Lens
import           Control.Monad.Trans.Control (MonadBaseControl)
import           Control.Monad.IO.Class      (MonadIO, liftIO)
import           Control.Monad.Except        (ExceptT (..), MonadError (..), runExceptT)
import           Control.Monad.Trans.State
import           Control.Monad.State.Class   (MonadState)
import           Data.ByteString.Char8       (ByteString)
import           Data.List.NonEmpty          (NonEmpty (..))
import qualified Data.List.NonEmpty          as NE
import           Data.Monoid                 ((<>))
import qualified Data.Pool                   as Pool
import           System.IO
import qualified Data.Map                    as M
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import qualified Network
import           Prelude

import Network.Kafka

class HasKafkaState m where
    getKafkaState :: m KafkaState
    putKafkaState :: KafkaState -> m ()

withKafkaViolently :: (MonadIO m, HasKafkaState m) => StateT KafkaState (ExceptT KafkaClientError IO) a -> m a
withKafkaViolently k = do
    s <- getKafkaState
    r <- liftIO . runExceptT $ runStateT k s
    case r of
        Left err -> error $ show err
        Right (a, newS) -> do
            putKafkaState newS
            return a
