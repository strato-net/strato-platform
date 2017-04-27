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
    label "cd9"
  }

  stages {
    stage('Build') {
      steps {
        sh 'basil build'
      }
    }

    stage ('HLint') {
      steps {
        sh 'stack install hlint'
        sh 'stack exec hlint -- .'
      }
    }

    stage('Test') {
      steps {
        echo "Running stack test"
        sh 'stack test'
        slackSend (
          color: 'good',
          message: "Build succeeded: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
        )
      }
    }

  }

  post {
    success {
      sh '''
        echo "Git branch: $BRANCH_NAME"
        if [ $BRANCH_NAME = master ]
        then
          echo "TODO: execute E2E tests here that depend on deployment"
        fi
        basil build --release
        basil push
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
