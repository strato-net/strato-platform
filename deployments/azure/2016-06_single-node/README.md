# How to use this image

Once your Azure Virtual Machine is running, it should provide the following web routes.
For the sake of example, assume that your machine has a public hostname HOSTNAME.

 - `http://HOSTNAME/strato-single` is where the BlockApps API can be reached.
    Queries to the api are made at paths such as `/eth/v1.1/<query>`; some significant examples are:

    - `http://HOSTNAME/strato-single/eth/v1.1/account?address=<ethereum address>` displays the metadata of the account at the given address: primarily its nonce and balance.
    - `http://HOSTNAME/strato-single/eth/v1.1/block?hash=<block hash>` displays the requested block, including the transactions it contains.
    - `http://HOSTNAME/strato-single/eth/v1.1/block/last/10` displays the last 10 blocks in the blockchain.
    - `http://HOSTNAME/strato-single/eth/v1.1/transaction?hash=<tx hash>` displays the given transaction.
    - `http://HOSTNAME/strato-single/eth/v1.1/transactionResult/<tx hash>` displays information on the VM run of the given transaction.  Unlike all the previous queries, this one is not part of the Ethereum standard, but a snapshot of the BlockApps virtual machine.

 - `http://HOSTNAME:8000` is where the Bloc API can be reached.  Some of its significant paths are:

    - `http://HOSTNAME:8000/users/<user name>`, which if targeted with a POST containing the following parameters will create a new Ethereum account for the named user (which is an abstraction of the BlockApps tools and not reflected in the blockchain at all) with, optionally, some initial funds.

      - `faucet=<boolean>`: whether to endow the new account with some free "ether" on the private blockchain
      - `password=<anything>`: encryption password for the new account's private key

    - `http://HOSTNAME:8000/users/<user>/<account address>/send, which if targeted with a POST containing the following parameters will send ether from the given user's given accound address to another address.

      - `toAddress=<address>`: the recipient
      - `value=<integer>`: how many ether to send
      - `password=<anything>`: the user account's encryption password.

    - `http://HOSTNAME:8000/users/<user>/<account address>/contract`, which if targeted with a POST containing the following parameters will compile and upload a contract:

      - `src=<solidity source>`: the contract source code
      - `args=<object>`: an object containing the values of the named arguments of the contract constructor
      - `password=<anything>`: The user account's encyption password.
    
    - `http://HOSTNAME:8000/users/<user>/<account address>/contract/call`, which if targeted with a POST containing the following parameters will call a method of the given contract (which must have been uploaded using the previous route):

      - `method=<method name>`: which function to call
      - `args=<object>`: an object containing the values of the named arguments of the Solidity method
      - `value=<integer>`: an ether value to include with the function call
      - `password=<anything>`: the user account's encryption password.

 - `http://HOSTNAME:9000` is the location of the Strato blockchain explorer.  There are no REST routes at this location, but the page there provides a live view into the state of the blockchain.

