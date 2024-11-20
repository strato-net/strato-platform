import React from 'react';

class LoginRedirect extends React.Component {
  componentDidMount() {
    window.location.replace('/');
  }

  render() {
    return <div>Redirecting...</div>;
  }
}

export default LoginRedirect;
