githubCredentials = [
  [
    $class: 'UsernamePasswordMultiBinding',
    usernameVariable: 'USR',
    passwordVariable: 'GITHUB_TOKEN',
    credentialsId: 'blockapps-cd-github'
  ]
]

pipeline {
  agent {
    label "strato-integration"
  }
  options { disableConcurrentBuilds() }

  stages {
    stage('Prepare') {
        steps {
               sh '''#!/bin/bash -l    
                docker-compose kill && docker-compose -v down
                docker ps
                sudo rm -rf repos silo
                '''
         }
    }
    
    stage('Build') {
         steps {
                withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {
                  sh '''#!/bin/bash -l
                    docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
                    git config --global credential.helper store
                    git clone https://$GH_USER:$GH_PASSWD@github.com/blockapps/silo.git
                    cd silo
                    cp /home/blockapps/basil .
                    ./basil clone
                    ./basil build 
                  '''
                 } 
          }
     }
     stage('Deploy') {
          steps {
                 sh '''#!/bin/bash -l
                  cd silo
                  ./basil compose > docker-compose.yml
                  genesisBlock=$(< gb.json) lazyBlocks=false miningAlgorithm=SHA apiUrlOverride=http://strato:3000 blockTime=2 minBlockDifficulty=8192 docker-compose up -d
                  docker ps
                 '''
          }
     }
            
     stage('E2E-Test') {
          steps {
                 sh '''#!/bin/bash -l
                 cd silo
                  ./test || true
                 '''
          }
     }      
  }

  post {
    success {
        slackSend (
        color: 'good',
        message: "Build Successful: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
        )
      sh '''
        echo "Build Successful for Git branch: $BRANCH_NAME"
      '''
    }

    failure {
      slackSend (
        color: 'danger',
        message: "Build failed: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
      )
    }
  }
}
