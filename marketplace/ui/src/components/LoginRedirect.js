import React from 'react';

class LoginRedirect extends React.Component {
  componentDidMount() {
    window.location.replace("/marketplace/")
  }

  render() {
    return <div>Redirecting...</div>;
  }
}

export default LoginRedirect;
