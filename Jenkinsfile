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
                    basil clone
                    basil compose --release > docker-compose.release.yml
                    basil snapshot > Basilfile.snapshot
                    basil build
                  '''
                 }
          }
     }
    stage('Deploy') {
      steps {
        sh '''#!/bin/bash -l
          cd silo
          basil compose > docker-compose.yml
          genesisBlock=$(< gb.json) lazyBlocks=false miningAlgorithm=SHA apiUrlOverride=http://strato:3000 blockTime=2 minBlockDifficulty=8192 docker-compose up -d
          docker ps
        '''
      }
    }

    stage('E2E-Test') {
      steps {
      sh '''#!/bin/bash -l
        cd silo
        ./test
      '''
      }
    }

    stage('Release') {
      steps {
        withEnv(["TAG_NAME=jenkins-build-${env.BUILD_NUMBER}", "PATH=$PATH:/usr/local/go/bin"]) {
          withCredentials([
            usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'),
            usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GITHUB_TOKEN', usernameVariable: 'USR')
          ]) {
            sh '''#!/bin/bash -l
              cd silo
              docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
              basil push
              ./docker-publish-images.sh
              RELEASE_DETAILS="--user blockapps --repo silo --tag $TAG_NAME"
              RELEASE_DATE=$(date +'%Y-%m-%d %H:%M:%S')
              github-release delete  $RELEASE_DETAILS || true
              github-release release $RELEASE_DETAILS --name "master @ $RELEASE_DATE"
              github-release upload $RELEASE_DETAILS --name "Basilfile" --file ./Basilfile.snapshot
              github-release upload $RELEASE_DETAILS --name "docker-compose.yml" --file ./docker-compose.release.yml
            '''
          }
        }
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
