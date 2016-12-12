#Setup and Test Strato Server Starting from Scratch

###Requirements
- Ubuntu 16.04
- Needs atleast 16GB of storage.
- 2 cores minimum. 4 recommended.

###Get git
```
apt-get install git
```

###Get the bootstrap script
Get the correct version of the script from github
```
wget -O bootstrap https://raw.githubusercontent.com/blockapps/silo/132922485_transaction-batching/bootstrap?token=<you have to go to github for the real URL>
```

###Make script executable
```
chmod +x bootstrap
```

###Run the bootstrap script
```
./bootstrap
```

###Clone silo
```
mgit clone https://github.com/blockapps/silo -b <branch name>
```

###Run the install script
```
cd silo; ./install local-to-docker
```

###Run the testing script
```
apiUrlOverride=http://strato:3000 ./test install-docker-compose start-docker kill-docker
```
Explanation of arguments for test script.
- **apiUrlOverride**: Lets you set the override the address of the strato endpoint, so you can actually hit your own docker behind NAT 
- **install-docker-compose**: This will install the dependencies required for deployment
- **start-docker**: This will bring up the docker containers to test against.
- **enable-ssl**: use https instead of http for deployment and testing (disabled by default).
- **kill-docker**: This will stop the containers and clear all storage used by processes after testing is finished.

If you deploying outside the testing process, use `./test` without any arguments to only run the tests without affecting the docker containers.

***YOU WILL NEED TO START DOCKER CONTAINERS WITH `apiUrlOverride=http://strato:3000` IF YOU ARE BEHIND NAT***
