import React from 'react'

const InternalError = () => {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
    <h1 className="text-4xl font-bold mb-4">500 Internal Server Error</h1>
    <p className="text-lg">Oops! Something went wrong on our end. Please try again later.</p>
  </div>
  )
}

export default InternalError
