{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeOperators
#-}

module BlockApps.Bloc.API.User where

import Servant.API
import Servant.Client

type GetUsers = "users"
  :> Get '[HTMLifiedJSON] [UserName]

type PostUser = "users"
  :> Capture "user" UserName
  :> ReqBody '[FormUrlEncoded] PostUserParameters
  :> Post '[HTMLifiedAddress] Address

type GetUserAddresses = "users"
  :> Capture "user" UserName
  :> Get '[HTMLifiedJSON] [Address]

type PostSend = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "send"
  :> ReqBody '[FormUrlEncoded] PostSendParameters
  :> Post '[HTMLifiedJSON] PostTransaction

type PostContract = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "contract"
  :> ReqBody '[FormUrlEncoded] SrcPassword
  :> Post '[JSON] Keccak256

type PostUploadList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "uploadList"
  :> ReqBody '[JSON] UploadList
  :> Post '[JSON] UnstructuredJSON

-- This should return the return value from the method call
type PostContractMethod = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "contract"
  :> Capture "contractName" ContractName
  :> Capture "contractAddress" Address
  :> "call"
  :> Post '[JSON] NoContent

-- POST /users/:user/:userAddress/sendList
type PostSendList = "users"
  :> Capture "user" UserName
  :> Capture "userAddress" Address
  :> "sendList"
  :> ReqBody '[JSON] PostSendListRequest
  :> Post '[JSON] [PostSendListResponse]

--POST /users/:user/:address/callList
type PostContractMethodList = "users"
  :> Capture "user" UserName
  :> Capture "address" Address
  :> "callList"
  :> ReqBody '[JSON] PostMethodListRequest
  :> Post '[JSON] [PostMethodListResponse]
