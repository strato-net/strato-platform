## Build a full Strato docker-deployment from scratch 

Build a versioned docker deployment, and run it on a docker-ready machine, or spin an Azure instance.

### gocd - build `latest`
  * This build should be triggered by a change to any of the dependencies.
  * The build status is updated in slack `#ci`
  
### gocd - build a versioned deployment
* Web interface `http://blockapps-cd.eastus.cloudapp.azure.com:8153/go/pipelines`
  * u/p admin:the-usual-12 
* Click on the `Pipelines` tab in the top nav bar
* Pipeline `strato_branch`
* Pipeline settings (little cog on top right)
  * Specify branch name for mgit under the `Parameters` tab, `BRANCH`
  * Specify the deployments repo branch name for mgit under the `Parameters` tab, `DEPLOYMENTS_BRANCH`
  * Specify version # for the docker images under the `Environment Variables` tab
    * `stratoVersion` - the docker images versions (if blank, will upload to `latest`)
    * please dont touch anything else
* Click on the `Pipelines` tab in the top nav bar
* Click `start` (play button) to start the build

### On a dokcer ready machine
* Log into our docker registry  (u/p:  blockapps/the-usual-12)

  `docker login auth.blockapps.net:5000`

* Pull the `latest` Strato Docker images from the registry, and start a single node

  `cd deployments/docker`
  
  `./start-strato.sh single`
  
  or pull `$VERSION`

  `stratoVersion=$VERSION ./start-strato.sh single`
  
### Spin an Azure image

* Instructions at https://github.com/blockapps/deployments/edit/develop/azure/createStratoInstance.md
  
