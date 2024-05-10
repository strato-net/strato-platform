import React, { useState, useEffect } from "react";
import {loadStripe} from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout
} from '@stripe/react-stripe-js';
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
  useLocation
} from "react-router-dom";

const useQuery = () => {
  const { search } = useLocation();
  return React.useMemo(() => new URLSearchParams(search), [search]);
}

const CheckoutForm = () => {
  let query = useQuery();
  const token = query.get("token");
  const redirectUrl = query.get("redirectUrl");
  const [data, setData] = useState(null);
  const [shouldCancel, setShouldCancel] = useState(true);

  const fetchSecretAndId = async () => {
    if (!data) {
      const res = await fetch(`${process.env.REACT_APP_SERVER_URL}/stripe/checkout/initiate?token=${token}&redirectUrl=${redirectUrl}`, {
        method: "GET",
      }).then((res) => res.json());
      setData(res);
    }
  };

  useEffect(() => {
    window.addEventListener("beforeunload", cancelOrder);

    fetchSecretAndId();
  }, []);

  const options = { clientSecret: data?.clientSecret };

  const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISH_KEY, {
    stripeAccount: data?.accountId,
  });

  const cancelOrder = async () => {
    if (shouldCancel) {
      await fetch(`${process.env.REACT_APP_SERVER_URL}/stripe/checkout/cancel?token=${token}&redirectUrl=${redirectUrl}`, {
        method: "GET",
      });
      window.location.replace(redirectUrl);
    }
  };

  const handleComplete = () => {
    setShouldCancel(false);
    window.location.replace(`${process.env.REACT_APP_SERVER_URL}/stripe/checkout/confirm?token=${token}&redirectUrl=${redirectUrl}`);
  }

  return ( 
    data ?
    (<div id="checkout">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{
          ...options,
          onComplete: handleComplete
        }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>) : 
    <div id="checkout"/>
  )
}

const Return = () => {
  const [status, setStatus] = useState(null);
  const [customerEmail, setCustomerEmail] = useState('');

  useEffect(() => {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const sessionId = urlParams.get('session_id');

    fetch(`/session-status?session_id=${sessionId}`)
      .then((res) => res.json())
      .then((data) => {
        setStatus(data.status);
        setCustomerEmail(data.customer_email);
      });
  }, []);

  if (status === 'open') {
    return (
      <Navigate to="/checkout" />
    )
  }

  if (status === 'complete') {
    return (
      <section id="success">
        <p>
          We appreciate your business! A confirmation email will be sent to {customerEmail}.

          If you have any questions, please email <a href="mailto:orders@example.com">orders@example.com</a>.
        </p>
      </section>
    )
  }

  return null;
}

const App = () => {
  return (
    <div className="App">
      <Router>
        <Routes>
          <Route path="/stripe/checkout" element={<CheckoutForm />} />
          <Route path="/stripe/checkout/confirm" element={<Return />} />
        </Routes>
      </Router>
    </div>
  )
}

export default App;