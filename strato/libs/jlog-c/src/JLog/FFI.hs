{-# LANGUAGE ForeignFunctionInterface #-}

-- | Low-level FFI bindings to the JLog C library.
-- JLog is a journaled log / persistent queue library from Circonus.
-- https://github.com/omniti-labs/jlog
module JLog.FFI (
  -- * Types
  JLogCtx,
  JLogId(..),
  JLogMessage(..),
  JLogErr(..),
  JLogPosition(..),
  -- * Context management
  jlog_new,
  jlog_ctx_init,
  jlog_ctx_close,
  jlog_ctx_err,
  jlog_ctx_err_string,
  -- * Writer operations
  jlog_ctx_open_writer,
  jlog_ctx_write,
  -- * Reader operations
  jlog_ctx_open_reader,
  jlog_ctx_read_interval,
  jlog_ctx_read_message,
  jlog_ctx_read_checkpoint,
  jlog_ctx_advance_id,
  -- * Subscriber management
  jlog_ctx_add_subscriber,
  jlog_ctx_remove_subscriber,
  jlog_ctx_list_subscribers,
  -- * Utility
  jlog_ctx_first_log_id,
  jlog_ctx_last_log_id,
) where

import Foreign.C.String
import Foreign.C.Types
import Foreign.Ptr
import Foreign.Storable
import Data.Word (Word32)

-- | Opaque JLog context handle
data JLogCtx

-- | JLog message ID (log file + offset within file)
data JLogId = JLogId
  { jlogIdLog    :: !CUInt   -- ^ Log file number
  , jlogIdMarker :: !CUInt   -- ^ Offset within log file
  } deriving (Show, Eq)

instance Storable JLogId where
  sizeOf _ = 8
  alignment _ = 4
  peek ptr = do
    l <- peekByteOff ptr 0
    m <- peekByteOff ptr 4
    return $ JLogId l m
  poke ptr (JLogId l m) = do
    pokeByteOff ptr 0 l
    pokeByteOff ptr 4 m

-- | JLog message structure returned by jlog_ctx_read_message
-- C struct layout (64-bit):
--   jlog_message_header_compressed *header;  // offset 0, 8 bytes
--   u_int32_t mess_len;                       // offset 8, 4 bytes
--   (4 bytes padding)
--   void *mess;                               // offset 16, 8 bytes
--   jlog_message_header_compressed aligned_header; // offset 24, 20 bytes
-- Total: 48 bytes (with padding)
data JLogMessage = JLogMessage
  { jlogMsgLen  :: !Word32    -- ^ Message length (at offset 8)
  , jlogMsgData :: !(Ptr ())  -- ^ Pointer to message data (at offset 16)
  } deriving (Show, Eq)

instance Storable JLogMessage where
  sizeOf _ = 48
  alignment _ = 8
  peek ptr = do
    len <- peekByteOff ptr 8   -- mess_len at offset 8
    dat <- peekByteOff ptr 16  -- mess at offset 16
    return $ JLogMessage len dat
  poke ptr (JLogMessage len dat) = do
    pokeByteOff ptr 8 len
    pokeByteOff ptr 16 dat

-- | JLog error codes
data JLogErr
  = JLOG_ERR_SUCCESS
  | JLOG_ERR_ILLEGAL_INIT
  | JLOG_ERR_ILLEGAL_OPEN
  | JLOG_ERR_OPEN
  | JLOG_ERR_NOTDIR
  | JLOG_ERR_CREATE_PATHLEN
  | JLOG_ERR_CREATE_EXISTS
  | JLOG_ERR_CREATE_MKDIR
  | JLOG_ERR_CREATE_META
  | JLOG_ERR_LOCK
  | JLOG_ERR_IDX_OPEN
  | JLOG_ERR_IDX_SEEK
  | JLOG_ERR_IDX_CORRUPT
  | JLOG_ERR_IDX_WRITE
  | JLOG_ERR_IDX_READ
  | JLOG_ERR_FILE_OPEN
  | JLOG_ERR_FILE_SEEK
  | JLOG_ERR_FILE_CORRUPT
  | JLOG_ERR_FILE_READ
  | JLOG_ERR_FILE_WRITE
  | JLOG_ERR_META_OPEN
  | JLOG_ERR_ILLEGAL_WRITE
  | JLOG_ERR_ILLEGAL_CHECKPOINT
  | JLOG_ERR_INVALID_SUBSCRIBER
  | JLOG_ERR_ILLEGAL_LOGID
  | JLOG_ERR_SUBSCRIBER_EXISTS
  | JLOG_ERR_CHECKPOINT
  | JLOG_ERR_NOT_SUPPORTED
  | JLOG_ERR_CLOSE_LOGID
  deriving (Show, Eq, Enum)

-- | Position flags for adding subscribers
data JLogPosition
  = JLOG_BEGIN  -- ^ Start from beginning of log
  | JLOG_END    -- ^ Start from current end (new messages only)
  deriving (Show, Eq)

-- Context management
foreign import ccall unsafe "jlog_new"
  jlog_new :: CString -> IO (Ptr JLogCtx)

foreign import ccall unsafe "jlog_ctx_init"
  jlog_ctx_init :: Ptr JLogCtx -> IO CInt

foreign import ccall unsafe "jlog_ctx_close"
  jlog_ctx_close :: Ptr JLogCtx -> IO ()

foreign import ccall unsafe "jlog_ctx_err"
  jlog_ctx_err :: Ptr JLogCtx -> IO CInt

foreign import ccall unsafe "jlog_ctx_err_string"
  jlog_ctx_err_string :: Ptr JLogCtx -> IO CString

-- Writer operations
foreign import ccall unsafe "jlog_ctx_open_writer"
  jlog_ctx_open_writer :: Ptr JLogCtx -> IO CInt

foreign import ccall unsafe "jlog_ctx_write"
  jlog_ctx_write :: Ptr JLogCtx -> Ptr a -> CSize -> IO CInt

-- Reader operations
foreign import ccall unsafe "jlog_ctx_open_reader"
  jlog_ctx_open_reader :: Ptr JLogCtx -> CString -> IO CInt

foreign import ccall unsafe "jlog_ctx_read_interval"
  jlog_ctx_read_interval :: Ptr JLogCtx -> Ptr JLogId -> Ptr JLogId -> IO CInt

foreign import ccall unsafe "jlog_ctx_read_message"
  jlog_ctx_read_message :: Ptr JLogCtx -> Ptr JLogId -> Ptr JLogMessage -> IO CInt

foreign import ccall unsafe "jlog_ctx_read_checkpoint"
  jlog_ctx_read_checkpoint :: Ptr JLogCtx -> Ptr JLogId -> IO CInt

foreign import ccall unsafe "jlog_ctx_advance_id"
  jlog_ctx_advance_id :: Ptr JLogCtx -> Ptr JLogId -> Ptr JLogId -> Ptr JLogId -> IO CInt

-- Subscriber management
foreign import ccall unsafe "jlog_ctx_add_subscriber"
  jlog_ctx_add_subscriber :: Ptr JLogCtx -> CString -> CInt -> IO CInt

foreign import ccall unsafe "jlog_ctx_remove_subscriber"
  jlog_ctx_remove_subscriber :: Ptr JLogCtx -> CString -> IO CInt

foreign import ccall unsafe "jlog_ctx_list_subscribers"
  jlog_ctx_list_subscribers :: Ptr JLogCtx -> Ptr (Ptr CString) -> IO CInt

-- Utility
foreign import ccall unsafe "jlog_ctx_first_log_id"
  jlog_ctx_first_log_id :: Ptr JLogCtx -> Ptr JLogId -> IO CInt

foreign import ccall unsafe "jlog_ctx_last_log_id"
  jlog_ctx_last_log_id :: Ptr JLogCtx -> Ptr JLogId -> IO CInt
