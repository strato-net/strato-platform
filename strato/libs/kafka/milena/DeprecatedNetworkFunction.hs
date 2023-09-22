{-
   In version 2.7.0.0, the haskell "network" package deprecated the "Network" and "Network.BSD" modules.
   Milena used a function in these modules.  The function was small and straightforward, so it has been
   copied here to keep milena working for stack LTS15.
-}

module DeprecatedNetworkFunction (connectTo) where

import Control.Exception
import Control.Monad (liftM)
import Network.Socket hiding (PortNumber, accept, socketPort)
import System.IO

connectTo :: HostName -> Int -> IO Handle
connectTo host port = do
  let caller = "Network.connectTo"
      serv = show port
  let hints =
        defaultHints
          { addrFlags = [AI_ADDRCONFIG],
            addrSocketType = Stream
          }
  addrs <- getAddrInfo (Just hints) (Just host) (Just serv)
  firstSuccessful caller $ map tryToConnect addrs
  where
    tryToConnect addr =
      bracketOnError
        (socket (addrFamily addr) (addrSocketType addr) (addrProtocol addr))
        close -- only done if there's an error
        ( \sock -> do
            connect sock (addrAddress addr)
            socketToHandle sock ReadWriteMode
        )

tryIO :: IO a -> IO (Either IOException a)
tryIO m = catch (liftM Right m) (return . Left)

firstSuccessful :: String -> [IO a] -> IO a
firstSuccessful caller = go Nothing
  where
    -- Attempt the next operation, remember exception on failure
    go _ (p : ps) =
      do
        r <- tryIO p
        case r of
          Right x -> return x
          Left e -> go (Just e) ps

    -- All operations failed, throw error if one exists
    go Nothing [] = ioError $ userError $ caller ++ ": firstSuccessful: empty list"
    go (Just e) [] = throwIO e
