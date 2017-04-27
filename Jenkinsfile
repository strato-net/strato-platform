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
        echo "Running unit tests"
        sh 'eval "$(cat run_unit_tests.sh)"'
      }
    }
  }

  post {
    success {
      sh '''
        echo "Git branch: $BRANCH_NAME"
        basil build --release
        basil push
        slackSend (
          color: 'good',
          message: "Build succeeded: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
        )

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
