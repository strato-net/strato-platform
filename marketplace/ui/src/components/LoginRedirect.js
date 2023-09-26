import React from 'react';
import { getCookie } from '../utils/cookie';

class LoginRedirect extends React.Component {
  componentDidMount() {
    const returnUrl = getCookie('returnUrl');

    // Check if the cookie exists. If there is a cookie we will redirect to the stored URL, otherwise we will redirect to a default path
    if (returnUrl) {
      // Clear the cookie by setting the expiration date to a past date
      document.cookie = 'returnUrl=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;';

      // Redirect to the stored URL
      window.location.replace(returnUrl);
    } else {
      // If the cookie doesn't exist or has an invalid value, redirect to a default path
      window.location.replace("/marketplace/");
    }
  }

  render() {
    return <div>Redirecting...</div>;
  }
}

export default LoginRedirect;
