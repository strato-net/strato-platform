pipeline {
  agent {
    label "cd9"
  }
  stages {
    stage('Build') {
      steps {
        sh '''#!/bin/bash -le
          docker build -t blockapps/smd-ui .
        '''
      }
    }
    stage('Run') {
      steps {
        sh '''#!/bin/bash -le
          docker rm -f smd-ui || true
          docker run -d --name smd-ui -p 3035:3002 -e NODE_NAME=BAYAR6 -e NODE_URL=http://bayar6.eastus.cloudapp.azure.com/ blockapps/smd-ui
          sleep 10
          curl localhost:3035
        '''
      }
    }
  }
}
