
import { useEffect } from 'react';
import Navbar from '../components/Navbar';
import AuthForm from '../components/AuthForm';

const Register = () => {
  useEffect(() => {
    document.title = "Register | STRATO Mercata";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="max-w-md mx-auto bg-white rounded-xl shadow-sm p-8 border border-gray-100">
          <AuthForm isRegister={true} />
        </div>
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>By creating an account, you agree to our</p>
          <div className="flex justify-center space-x-3 mt-1">
            <a href="#" className="text-strato-blue hover:underline">Terms of Service</a>
            <span>•</span>
            <a href="#" className="text-strato-blue hover:underline">Privacy Policy</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
