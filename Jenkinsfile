pipeline {
  agent {
    label "strato-integration"
  }
  options { disableConcurrentBuilds() }

  stages {
    stage('Prepare') {
      steps {
        sh '''#!/bin/bash -le
          docker-compose kill && docker-compose -v down
          docker ps
          sudo rm -rf repos silo
        '''
       }
    }
    
    stage('Build') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {
          sh '''#!/bin/bash -le
            docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
            git config --global credential.helper store
            git clone https://$GH_USER:$GH_PASSWD@github.com/blockapps/silo.git
            cd silo
            basil clone
            basil compose --release > docker-compose.release.yml
            basil snapshot > Basilfile.snapshot
            basil build
            cd repos/blockapps-swagger
            git checkout dist/swagger-ui-bundle.js dist/swagger-ui-bundle.js.map dist/swagger-ui.js dist/swagger-ui-standalone-preset.js dist/swagger-ui-standalone-preset.js.map
          '''
          echo 'TODO: FIX it: after basil build swagger repo is left dirty with some modified .js files. Workaround: above two lines to reset dirty blockapps-swagger repo with a git checkout'
        }
      }
    }
    stage('Deploy') {
      steps {
        sh '''#!/bin/bash -le
          cd silo
          basil compose > docker-compose.yml

          NODE_NAME=localhost \
          BLOC_URL=http://localhost/bloc/v2.1 \
          BLOC_DOC_URL=http://localhost/docs/?url=/bloc/v2.1/swagger.json \
          STRATO_URL=http://localhost/strato-api/eth/v1.2 \
          STRATO_DOC_URL=http://localhost/docs/?url=/strato-api/eth/v1.2/swagger.json \
          genesisBlock=$(< gb.json) \
          stratoHost=nginx \
          cirrusurl=nginx/cirrus \
          ssl=false \
          docker-compose up -d

          docker ps
        '''
      }
    }

    stage('E2E-Test') {
      steps {
      echo 'TODO: Fix inconsistent tests'
      // sh '''#!/bin/bash -le
      //  cd silo
      //  suite="e2e/smoke.test.js" ./test
      // '''
      }
    }

    stage('Release') {
      steps {
        withEnv(["TAG_NAME=build-${env.BUILD_NUMBER}", "PATH=$PATH:/usr/local/go/bin"]) {
          withCredentials([
            usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'),
            usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GITHUB_TOKEN', usernameVariable: 'USR')
          ]) {
            sh '''#!/bin/bash -le
              cd silo
              docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
              basil build --release
              basil push
              ./docker-publish-images.sh --prepare-tagged-release
              RELEASE_DATE=$(date +'%Y-%m-%d %H:%M:%S')
              # Create release in blockapps/silo repo
              SILO_RELEASE_DETAILS="--user blockapps --repo silo --tag $TAG_NAME"
              github-release delete  $SILO_RELEASE_DETAILS || true
              github-release release $SILO_RELEASE_DETAILS --name "master @ $RELEASE_DATE"
              github-release upload $SILO_RELEASE_DETAILS --name "Basilfile" --file ./Basilfile.snapshot
              github-release upload $SILO_RELEASE_DETAILS --name "docker-compose.yml" --file ./docker-compose.release.yml
              github-release upload $SILO_RELEASE_DETAILS --name "docker-compose.STRATO-GS.yml" --file ./docker-compose.STRATO-GS.yml

              #echo 'deleting old blockapps/strato-getting-started releases'
              #for tag in $(git tag); do
              #  github-release info --user blockapps --repo strato-getting-started --tag $tag && \
              #      (github-release delete --user blockapps --repo strato-getting-started --tag $tag || true)
              #  # git push origin :refs/tags/$tag
              #  # git tag -d $tag
              #done

              echo 'creating blockapps/strato-getting-started release'
              STRATOGS_RELEASE_DETAILS="--user blockapps --repo strato-getting-started --tag $TAG_NAME"
              github-release delete  $STRATOGS_RELEASE_DETAILS || true
              github-release release $STRATOGS_RELEASE_DETAILS --name "master @ $RELEASE_DATE"
              github-release upload $STRATOGS_RELEASE_DETAILS --name "docker-compose.yml" --file ./docker-compose.STRATO-GS.yml
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
