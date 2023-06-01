import React from 'react';

class ExternalRedirect extends React.Component {
  componentDidMount() {
    window.location.replace("/marketplace/")
  }

  render() {
    return <div>Redirecting...</div>;
  }
}

export default ExternalRedirect;