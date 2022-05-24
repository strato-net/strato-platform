#!/usr/bin/python3

import os, signal
import getopt, sys
import json
import secrets
import requests
from copy import deepcopy

############################################
# Dictionary formats for POST request body #
############################################

FUNCTION_PAYLOAD = {
    "payload": {
        "chainid": "",
        "contractName": "",
        "contractAddress": "",
        "method": "",
        "args": {}
    },
    "type": "FUNCTION"
}

CONTRACT_PAYLOAD = {
    "payload": {
        "chainId": "",
        "contract": "",
        "args": {},
        "metadata": {
            "history": "",
            "index": "",
            "VM": "SolidVM"
        }
    },
    "type": "CONTRACT",
}

TRANSACTION_FORMAT = {
        "txs": [],
        "txParams": {
            "gasLimit": 10000000000,
            "gasPrice": 1,
        },
        "srcs": {}
}


# GLOBAL (contract_name, contract_src)
CONTRACT_TUPLES = []

# (contract_address, contract_name, contract_method, contract_args)
FUNCTION_CALL_TUPLES = []


#############
# Functions #
#############

# Testing setup helper functions
# Must have a directory called 'test-contracts' with contracts 
# you want to add to the blockchain

def generateTestContracts():
    CONTRACT_DIRECTORY = '/var/lib/strato/syncspeedtest/test-contracts/'
    directory = os.listdir(CONTRACT_DIRECTORY)

    for contract in directory:
        src_code = open(CONTRACT_DIRECTORY + contract, 'r').read() # Get file contents
        src_name = contract.split('.sol')[0] # ['filename', '.sol']
        contract_tuple = (src_name, src_code)
        CONTRACT_TUPLES.append(contract_tuple)

# Uploading these test contracts to the chain 

def uploadTestContracts(chainId=None):
    headers = {
        "X-USER-UNIQUE-NAME": "user1@blockapps.net",
        "Content-type": "application/json",
        "Accept": "application/json"
    }

    POST_URL = "http://strato:3000/bloc/v2.2/transaction?resolve=true"
    strato_tx = deepcopy(TRANSACTION_FORMAT)

    for contract in CONTRACT_TUPLES:
        tx_payload, source_code = generateContractCreationPayload(contract, chainId)
        strato_tx["srcs"].update(source_code["srcs"])

        # Hardcoded since this is the only contract
        # that requires constructors
        contract_name = contract[0]
        if contract_name == 'TitleHeavy':
            tx_payload["payload"]["args"] = {
                        "_s0": "a",
                        "_s1": "b",
                        "_s2": "c",
                        "_s3": "d",
                        "_s4": "e",
                        "_s5": "f",
                        "_s6": "g"
                   }

        strato_tx["txs"].append(tx_payload)
    
    response = requests.post(POST_URL, headers=headers, data=json.dumps(strato_tx))

    # This maps the newly created contracts to their respective addresses
    generateTestFunctions(response.json())

def generateTestFunctions(tx_results):
    for result in tx_results:
        contract_name   = result["data"]["contents"]["name"]
        contract_addr   = result["txResult"]["contractsCreated"].split(',')[0]
        contract_method = ""
        contract_args   = {}

        # SimpleStorage set(random_number)
        if contract_name == "SimpleStorage":
            rand_num = secrets.randbelow(65335)
            contract_method = "set"
            contract_args = {
                        "_x": rand_num
                    }

        # SimpleIncrement increment() or get()
        if contract_name == "SimpleIncrement":
            contract_method = secrets.choice(["increment", "get"])

        # TitleMo TitleMo(some_string)
        if contract_name == "TitleMo":
            contract_method = "TitleMo"
            contract_args = {
                        "_vin": "bl0ckch41n"
                    }

        # Util b32(some_string)
        if contract_name == "Util":
            contract_method = "b32"
            contract_args = {
                        "source": "STRATO_IS_COOL"
                    }

        if contract_name == "TitleHeavy":
            contract_method = "setUint"
            contract_args = {
                        "_u0": 0,
                        "_u1": 1,
                        "_u2": 2,
                        "_u3": 3,
                        "_u4": 4,
                        "_u5": 5,
                        "_u6": 6
                    }

        FUNCTION_CALL_TUPLES.append((contract_name, contract_addr, contract_method, contract_args))

def testSetup(testChainId=None):
    generateTestContracts()
    uploadTestContracts(chainId=testChainId)

# Generate a JSON that represents a transaction payload

# contractTuple -> tuple that contains:
#   contract_name -> name of contract
#   contract_src  -> contract source code
# chainId -> optional argument, define the chain to append this tx to

# return -> tuple of payload object and srcs object

def generateContractCreationPayload(contractTuple, chainId=None):
    # unpack tuple
    (contract_name, contract_src) = contractTuple        

    # setup contract payload
    contract   = deepcopy(CONTRACT_PAYLOAD)
    sourcecode = { "srcs": {} } 

    # update fields
    contract["payload"]["contract"] = contract_name
    contract["payload"]["chainid"]  = chainId
    sourcecode["srcs"][contract_name] = contract_src

    # Hardcoded since this is the only contract
    # that requires constructors
    if contract_name == 'TitleHeavy':
        contract["payload"]["args"] = {
                    "_s0": "a",
                    "_s1": "b",
                    "_s2": "c",
                    "_s3": "d",
                    "_s4": "e",
                    "_s5": "f",
                    "_s6": "g"
                }

 
    return (contract, sourcecode)

# Generate a JSON that represents a function call payload

# contractTuple -> tuple that contains:
#   contract_address -> address of contract
#   contract_name    -> name of contract
#   contract_method  -> name of function to be called
#   contract_args    -> arguments of function (if necessary, else input an empty {})
# chainId -> optional argument, define the chain to append this tx to

# return -> function call object

def generateFunctionCallPayload(contractTuple, chainId=None):
    # unpack tuple
    (contract_address, contract_name, contract_method, contract_args) = contractTuple
    function_call = deepcopy(FUNCTION_PAYLOAD)

    # update fields
    function_call["payload"]["contractName"] = contract_name
    function_call["payload"]["contractAddress"] = contract_address
    function_call["payload"]["method"] = contract_method
    function_call["payload"]["args"] = contract_args
    function_call["payload"]["chainid"] = chainId

    return function_call


# Generate a block of transactions
# blockSize -> set the block size limit, default to 500
# Returns the body of the POST request to be sent to blockchain

def generateTransactionBatch(chainId=None, batchSize=500):
    TYPES      = ["CONTRACT", "FUNCTION"]
    BLOCK_SIZE = range(1, batchSize)

    strato_tx  = deepcopy(TRANSACTION_FORMAT)
    block_size = secrets.choice(BLOCK_SIZE) # choose a random number

    for i in range(block_size):
        tx_type = secrets.choice(TYPES) # randomly decide what kind of tx to create
        if tx_type == "CONTRACT":
            picked_contract = secrets.choice(CONTRACT_TUPLES)
            tx_payload, source_code = generateContractCreationPayload(picked_contract, chainId)
            strato_tx["txs"].append(tx_payload)
            strato_tx["srcs"].update(source_code["srcs"])

        if tx_type == "FUNCTION":
            picked_functioncall = secrets.choice(FUNCTION_CALL_TUPLES)
            tx_payload = generateFunctionCallPayload(picked_functioncall, chainId)
            strato_tx["txs"].append(tx_payload)


    #print(json.dumps(strato_tx, indent=4))
    return strato_tx

# POST a block JSON object to the network
# resolve -> boolean to determine if the script should wait for tx resolution

def POSTtoBlockchain(block, resolve=False):
    headers = {
        "X-USER-UNIQUE-NAME": "user1@blockapps.net",
        "Content-type": "application/json",
        "Accept": "application/json"
    }

    POST_URL = "http://strato:3000/bloc/v2.2/transaction"

    if resolve:
        POST_URL += "?resolve=true"

    r = requests.post(POST_URL, headers=headers, data=json.dumps(block))
    #print(json.dumps(r.json(), indent=4))

    return True

def createTestChain():
    headers = {
        "X-USER-UNIQUE-NAME": "user1@blockapps.net",
        "Content-type": "application/json",
        "Accept": "application/json"
    }

    KEY_API = "http://vault-wrapper:8000/strato/v2.3/key"
    node_details = requests.get(KEY_API, headers=headers).json()
    node_addr = node_details["address"]
    node_pubkey = node_details["pubkey"]
    node_ip_addr = requests.get('https://api.ipify.org').content.decode('utf8')

    CHAIN_CREATION_API = "http://strato:3000/bloc/v2.2/chain"
    payload = {
        "args": {},
        "balances": [
                {
                    "balance": 1111111111,
                    "address": node_addr,
                }
            ],
        "members": [
                {
                    "address": node_addr,
                    "enode": "enode://{node_pubkey}@{node_ip_addr}30303".format(node_pubkey, node_ip_addr),
                }
            ],
        "src": "pragma solidity ^0.4.24;\n \ncontract AutoApprove { \n event MemberAdded (address member, string enode); \n event MemberRemoved (address member); \n \n function voteToAdd(address m, string e) { \n emit MemberAdded(m,e); \n } \n \n function voteToRemove(address m) { \n emit MemberRemoved(m); \n } \n}",
        "label": "testchain" + str(secrets.randbelow(99999))
    }

    chainId = requests.post(CHAIN_CREATION_API, headers=headers, data=json.dumps(payload)).json()
    print("Private chain successfully created:", chainId)
    return str(chainId)

def getLatestBlockNumber():
    HEALTH_API = "http://apex:3001/status"
    response = requests.get(HEALTH_API)
    BLOCK_COUNTER = int(response.json()["lastBlock"]["number"])
    return BLOCK_COUNTER

# Usage
# ./syncTest
#   -a, --amount <int> : amount of blocks to generate
#   -t, --target <int> : target a certain chain length
#   -k, --kill         : kills the script if still generating blocks
#   -p, --private      : puts all transactions

def main():
    CHAIN_ID = None
    BLOCK_LIMIT = 0

    arg_list = sys.argv[1:]
    options = "a:t:pk"
    long_options = ["amount", "target", "private", "kill"]

    try:
        arguments, values = getopt.getopt(arg_list, options, long_options)
        
        for currArg, currValue in arguments:
            if currArg in ("-a", "--amount"):
                blocks_to_add = int(currValue)
                curr_block = getLatestBlockNumber()
                BLOCK_LIMIT = blocks_to_add + curr_block
            elif currArg in ("-t", "--target"):
                BLOCK_LIMIT = int(currValue)

            if currArg in ("-p", "--private"):
                CHAIN_ID = createTestChain()            

            if currArg in ("-k", "--kill"):
                active_pid = os.environ["SYNC_SPEED_TEST_SCRIPT_PID"]
                if active_pid:
                    os.kill(int(active_pid), signal.SIGKILL)
                return True

    except getopt.error as e:
        print(str(e))

    # Necessary for ./syncTest --kill 
    os.environ["SYNC_SPEED_TEST_SCRIPT_PID"] = str(os.getpid())

    print('Simulating blockchain...')
    testSetup(testChainId=CHAIN_ID)

    RESOLVE     = True # True if you want to wait for transactions to resolve and not DDoS it
    BLOCK_COUNTER = getLatestBlockNumber()

    while BLOCK_COUNTER <= BLOCK_LIMIT:
        new_block = generateTransactionBatch(chainId=CHAIN_ID, batchSize=20)
        POSTtoBlockchain(new_block, resolve=RESOLVE)
        print('Transaction posted... Amount resolved:', len(new_block["txs"]))
        
    print('Done!')

if __name__ == "__main__":
    main()