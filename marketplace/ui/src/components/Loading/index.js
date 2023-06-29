import React from 'react';

import { Spinner } from '@shopify/polaris';
import PropTypes from 'prop-types';
import styled from 'styled-components';

const LoadingStyle = styled.div`
  display: flex;
  justify-content: center;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-height: 300px;
`;

const Text = styled.div`
  font-size: x-large;
  padding: 0 0 14px 16px;
`;

const Loading = () => (
  <LoadingStyle id="loader">
    <Text>Loading...</Text>
    <Spinner size="large" color="teal" />
  </LoadingStyle>
);

Loading.propTypes = {
  t: PropTypes.func
};

export default Loading;
