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
  const [itemList, setItemList] = useState([]);
  const [isComplete, setIsComplete] = useState(false);

  const fetchSecretAndId = async () => {
    if (!data) {
      const res = await fetch(`${process.env.REACT_APP_SERVER_URL}/stripe/checkout/initiate?token=${token}&redirectUrl=${redirectUrl}`, {
        method: "GET",
      }).then((res) => res.json());
      setData(res);
    }
  };

  const options = { clientSecret: data?.clientSecret };

  const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISH_KEY, {
    stripeAccount: data?.accountId,
  });

  const confirmOrder = async () => {
    const res = await fetch(`${process.env.REACT_APP_SERVER_URL}/stripe/checkout/confirm?token=${token}`, {
      method: "GET",
    }).then((res) => res.json());
    setItemList(res);
    setIsComplete(true);
  }

  const cancelOrder = async () => {
    const res = await fetch(`${process.env.REACT_APP_SERVER_URL}/stripe/checkout/cancel?token=${token}`, {
      method: "GET",
    }).then((res) => res.json());
  }

  useEffect(() => {
    const handleUnload = (event) => {
      if (data && !isComplete) {
        cancelOrder();
      }
    }

    fetchSecretAndId();

    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [data, isComplete]);

  useEffect(() => {
    if (itemList.length > 0) {
      window.location.replace(redirectUrl);
    }
  }, [itemList]);

  const handleComplete = () => confirmOrder();

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

const App = () => {
  return (
    <div className="App">
      <Router>
        <Routes>
          <Route path="/stripe/checkout" element={<CheckoutForm />} />
        </Routes>
      </Router>
    </div>
  )
}

export default App;