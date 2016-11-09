#Setup and Test Strato Server Starting from Scratch

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

###Run the testing script (all arguments are optional)
```
./test
./test install-docker-compose start-docker kill-docker
```
Explanation of arguments for test script. You can run the test script without any of these arguments if you are deploying outside of this process.
- **install-docker-compose**: This will install the dependencies required for deployment
- **start-docker**: This will bring up the docker containers to test against.
- **kill-docker**: This will stop the containers and clear all storage used by processes after testing is finished.
