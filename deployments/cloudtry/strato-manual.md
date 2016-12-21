# Blockapps STRATO
Your new STRATO instance is a self-contained blockchain sandbox environment
tuned to the Ethereum system.  It is accessible through a web-based RESTful
API available at the URL of the instance (e.g.
`http://mystratonode.centralus.cloudapp.azure.com`), and more powerfully through
the Node.js library `blockapps-js` and developer tool bloc, both available on
NPM.

## Interacting with STRATO
Once you have found the API site, you can use STRATO to drive your blockchain
through HTTP requests, typically using the `bloc` tool.  In this trial, `bloc`
is installed on the virtual machine; in general, it is available on NPM as
`blockapps-bloc`.

In your startup confirmation email, you will have received access information
to login to the STRATO virtual machine via SSH (if you do not have an SSH
client installed, you can use the online one at
`https://tools.bartlweb.net/webssh/`).  For instance:
```
url:
strato32449.centralus.cloudapp.azure.com

sshLogin:
strato

sshPassword:
BlockappsPassword32449
```
SSH to the virtual machine using this information and do the following:

1. Enter the Docker container, `docker exec -it strato /bin/bash`.

2. Once in, change to the bloc demo directory: `cd /usr/share/strato/demo`.
Run `bloc compile`, or `bloc compile <contract name>`, for one of the contracts
called `<contract name>.sol` in the subdirectory `app/contracts/`.

3. Run `bloc genkey` to choose a password for securing a new Ethereum private
key and its associated account, which will be used to deploy and operate this
contract.

4. Now run `bloc upload <contract name>` to create the contract on the
   blockchain.  You must omit the `.sol` extension of the filenames in
   `app/contracts`.

5. To test it with a templated web site, run `bloc start` and then access your
API url from a web browser on port 3000.  You will be able to run any function
defined in the contract and see its output and the effect on contract
variables.

## Guide to the demo contracts

The demo is equipped with five simple Solidity contracts intended to showcase
the capabilities of `blockapps-js`, the Javascript library that powers bloc.

### SimpleStorage

This contract is a simple storage variable with a getter and setter function.
When you visit its page in the bloc API, the output text box will show the
variable's value changing, or being returned, as you apply these functions.

### SimpleDataFeed

This similar contract has just a variable and a setter, but actually has the
same functionality because `blockapps-js` can interpret storage variables
directly without the need to call a getter.  It models an application where
many observers consult the contract for its stored value (say, the price of an
asset) but only the owner may update that value.

### Payout

This contract shows how ether may be stored and transferred by contracts.  It
stores three addresses, nominally belonging to three humans, and fixes an
ownership distribution of the contract account's ether balance among them (the
`Setup` function).  When `Setup` is called, a value may be sent with it
voluntarily, and is added to the contract's balance.  This balance is then
disbursed to the three stakeholders by the `Dividend` function.  Although bloc
doesn't display the balances of these three addresses, you can view them by
viewing the API query url `<API url>/eth/v1.0/account?address=<addr>`, where
`<addr>` may be any of the three stored in the contract.

### Array

A more complex contract than the previous ones, this one implements a
distribution scheme as well, but in which new participants can join with
exponentially decreasing stakes.  The `Stake` function initializes the scheme,
and `addStakeHolder` gives its argument address half of the available stake in
the contract's balance.  As with `Payout`, this function should be called with
an "investment" value of ether, so that when `payout` is called, each
participant gets their percentage of the stake in the total ether amount held
at that time.  Also again, these participants' balances can be viewed by making
an API query for their addresses.  Note that although the addresses are *not*
hard-coded, the display text will show the `stakeHolders` array containing all
of them in order of signing up.

### SimpleMultiSig

This contract is quite elaborate and requires the creation of *several* private
keys via `bloc genkey`.  The address that uploads the contract is "bob" and two
others, "alice1" and "alice2", may join via `register`.  The contract is
intended to custody a balance of ether to be distributed, via `withdraw`, to
some other specified address, but *only* if this is requested by one of the
alices *and* if two of the three participants have already "signed off" on this
distribution.  Any of the three participants may call `addSignature` using
their private key to sign off (once and only once each), and as with previous
contracts, any of these function calls can include an ether value to be
invested in the contract.  Then a withdrawal may be attempted by calling
`withdraw`, which verifies the distribution conditions.  The recipient, who is
specified in the function call, can be inspected as with the previous two
contracts.

## Writing your own contracts
You can place any contract written in Solidity into `app/contracts`.  Solidity
is documented at `https://solidity.readthedocs.org/en/latest/` and resembles
Javascript in its syntax.

## Administration of the STRATO machine
STRATO runs in a Docker container on the virtual machine,
which you can access using the instructions described above.  Aside from
trying out the `bloc` demo, you can also control the STRATO processes
themselves.

Inside the Docker container, you interact with Strato using the `strato` command to
start or stop the suite of processes that is Strato itself.  Logs are in
/var/log/strato.  You can, for instance, see the virtual machine output at
`/var/log/strato/ethereum-vm`.  

If the API becomes unresponsive or the Docker container simply stops, you can
restart it from inside the VM but *outside* the container by running `docker
restart strato`.
