
import { useEffect } from 'react';
import Navbar from '../components/Navbar';
import AuthForm from '../components/AuthForm';

const Login = () => {
  useEffect(() => {
    document.title = "Login | STRATO Mercata";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow-sm p-8 border border-gray-100">
          <AuthForm isRegister={false} />
        </div>
      </div>
    </div>
  );
};

export default Login;
