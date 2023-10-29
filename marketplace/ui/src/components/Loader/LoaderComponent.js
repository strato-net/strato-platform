import { Spin } from 'antd'
import React from 'react'

const LoaderComponent = () => {
  return (
    <div className="h-screen flex justify-center items-center mx-auto">
      <Spin spinning={true} size="large" />
    </div>
  )
}

export default LoaderComponent
