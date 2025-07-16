import React from 'react';
import { Helmet } from 'react-helmet';

const HelmetComponent = ({ title, description, link }) => {
  return (
    <Helmet>
      <meta charSet="utf-8" />
      <title>{title}</title>
      <meta property="og:title" content={title?.split('|')[0]} />
      <meta name="description" content={description} />
      <meta property="og:description" content={description} />
      <link rel="canonical" href={link} />
    </Helmet>
  );
};

export default HelmetComponent;
