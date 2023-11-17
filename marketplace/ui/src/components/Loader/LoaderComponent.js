import React from "react";
import { Spin } from "antd";

const LoaderComponent = () => {
  return (
    <div className="h-screen flex justify-center items-center mx-auto">
      <Spin spinning={true} size="large" />
    </div>
  );
};

export default LoaderComponent;
