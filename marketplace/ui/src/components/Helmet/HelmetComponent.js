import React from 'react';
import { Helmet } from "react-helmet";

const HelmetComponent = ({ title, description, link }) => {
  return (
    <Helmet>
      <meta charSet="utf-8" />
      <title>{title} | STRATO Mercata Marketplace</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={link} />
    </Helmet>
  )
}

export default HelmetComponent
