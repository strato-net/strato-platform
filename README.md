
![logo](http://blockapps.net/wp-content/uploads/2016/12/blockapps-logo-horizontal-blue-for-web-transparent.png)

#monstrato Build Guide

Note: If you are running through this guide and find something doesn't work, please update it.

## mgit
You must clone this repository using [mgit](http://github.com/blockapps/mgit)-- if you use the old-fashioned git you will be missing important components.

```
> git clone http://github.com/blockapps/mgit.git
> cd mgit
> stack install
> alias mgit=./.stack-work/.stack-work/install/x86_64-osx/lts-3.4/7.10.2/bin/mgit
> cd ..
> mgit clone http://github.com/blockapps/monstrato.git
> cd monstrato
```

## alex
`alex` is a haskell library for building lexers, and is a build-tool dependency for the repo. Make sure `~/.local/bin` is on your `PATH`.
```
> stack install alex
```

## postgres
At the time of writing this it seems like we're able to use the latest postgres (v9.6), but ask if you are unsure which version you need. To install:
### MacOSX
1. Use `brew search postgresql` to find out if can simply do `brew install postgresql` or need to specify `brew install homebrew/versions/postgresql96`.
2. At this point brew should ask you if you would like to start the postgres server at startup time. To save yourself some pain, this might be a good idea.

### Ubuntu
```
> sudo apt-get install postgresql-9.6 
```
Make sure there is a postgres superuser named `postgres` (should exist by default) with password `api` (by hand). On Ubuntu, you might also need to change some configuration in `/etc/postgresql/9.6/main`-- namely where it says "Allow replication connections from localhost, by a user with the replication privelage.", change the `METHOD` for the `postgres` user of type `host` to `md5`.

## LevelDB
At the time of writing this the latest version is 1.19.
### MacOSX
```
> brew install snappy
> git clone https://github.com/google/leveldb.git
> git leveldb
> make
```
### Ubuntu 
```
> sudo apt-get install snappy-dev
> git clone https://github.com/google/leveldb.git
> git leveldb
> make
```

## Kafka
Currently we're using v0.9.1.1, but this can change in the future. You'll need the Java 8 runtime environment and Zookeeper 3.4.whatever.

### MacOSX
Again, you can use `brew search *` to figure out if the version you're looking for is currently on tap.
```
> brew cask install java 
> brew install zookeeper
> brew install kafka
```
### Ubuntu
```
> sudo apt-get install openjdk-8-jre 
> sudo apt-get install zookeeperd=3.4.8-1
> cd <path-to-monstrato-repo>/deployments/dpkg/kafka
> ./setupKafka
> sudo dpkg -i kafka.deb
> sudo dpkg -i kafka.deb
```
This does it for dependencies. At the top level of the `monstrato` repo you should be able to run `stack install`.

#Setting Up a Client Node

Make sure you are running Zookeeper, then start your kafka server. On Mac this would be something like
```
> brew services start zookeeper
> brew services start kafka
``` 

Make  directory called nodes, and inside of this directory make a node named with the current monstrato branch you are working on, e.g.
```
> mkdir -p nodes/master-node
> cd nodes/master-node
``` 

Run `strato-setup` (an executable in `~/.local/bin` created when you ran `stack install`) with arguments telling it postgres and your kafka server
```
> strato-setup -u postgres -p -K localhost
``` 
Note: It could be the case that you don’t have the blockchain db in postgres, if you get some error indicating this do

```
> cd blockapps-data
> stack exec -- global-db
``` 

1. You should now be able to see some directories and a genesis block `livenetGenesis.json`. (If for some reason this genesis block wasn’t created, you can find it in the repo. It will also create a database called `eth_<SOME_HASH>`. Next run `ethereum-discover`. This will start the peer finding process, writing peer info to the `etc` database. After this has run for a while, you can leave it as a background process or kill it.

2. Run `strato-p2p-client --sqlPeers`, sit back, and prepare for a long wait.  Watch the screen, you will see the client attempt to connect to the peers it found in step one, sequentially.  NOTE!  This will take a long time to succeed!  Most advertised peers in the world aren’t functional (for various reasons), so you will see (sometimes 10-20 minutes) of failed connection attempts.  Eventually it will succeed, and you will see blocks begin to download.
3. Once blocks have arrived, you can run strato-sequencer, whose job it is to order blocks/TXs, and remove redundancy. 
4. Now, run ethereum-vm --miningVerification=false to run the code in the contracts in the given block.  You will see the result of running the many contracts on scroll by on the screen (Note- in the ethereum livenet, no transactions exist until over 40k blocks have come through). 
5. Finally, you can run strato-index and strato-api.  With these commands running, you should be able to visit our API at http://localhost:3000 . 
