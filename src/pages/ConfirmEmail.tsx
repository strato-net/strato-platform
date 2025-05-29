
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, Mail, ArrowRight, RotateCcw } from "lucide-react";
import { useToast } from '@/hooks/use-toast';

interface FormData {
  username?: string;
  email?: string;
  password: string;
  confirmPassword?: string;
  telegram?: string;
}

const ConfirmEmail = () => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const formData = location.state?.formData as FormData;
  const email = formData?.email || 'your@email.com';

  useEffect(() => {
    document.title = "Confirm Email | STRATO Mercata";
    
    // Redirect if no form data
    if (!formData) {
      navigate('/register');
      return;
    }

    // Start countdown timer
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [formData, navigate]);

  const handleConfirm = async () => {
    if (code.length !== 6) {
      toast({
        title: "Invalid code",
        description: "Please enter a 6-digit verification code.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Simulate email verification (for demo purposes)
      setTimeout(() => {
        // For demo, accept any 6-digit code
        toast({
          title: "Email verified",
          description: "Your email has been successfully verified.",
        });
        
        // Generate mock wallet data
        const walletData = {
          username: formData.username || "user_" + Math.floor(Math.random() * 10000),
          blockchainAccount: "0x" + Array.from({length: 40}, () => 
            "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(''),
          privateKey: Array.from({length: 64}, () => 
            "0123456789abcdef"[Math.floor(Math.random() * 16)]).join('')
        };
        
        navigate('/wallet-created', { state: { walletData } });
        setLoading(false);
      }, 1500);
    } catch (error) {
      setLoading(false);
      toast({
        title: "Verification failed",
        description: "Invalid verification code. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    try {
      // Simulate resending email
      setTimeout(() => {
        toast({
          title: "Code resent",
          description: "A new verification code has been sent to your email.",
        });
        setTimeLeft(60);
        setCode('');
        setResendLoading(false);
      }, 1000);
    } catch (error) {
      setResendLoading(false);
      toast({
        title: "Error",
        description: "Failed to resend verification code. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (!formData) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="max-w-md mx-auto">
          <Card className="border border-gray-200">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-strato-blue to-strato-purple flex items-center justify-center">
                  <Mail className="h-8 w-8 text-white" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-gray-800">Verify Your Email</CardTitle>
              <CardDescription className="text-gray-600 mt-2">
                We've sent a 6-digit verification code to<br />
                <span className="font-medium text-gray-800">{email}</span>
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center space-y-4">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  className="justify-center"
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
                
                <p className="text-sm text-gray-500 text-center">
                  Enter the 6-digit code from your email
                </p>
              </div>
              
              <div className="text-center">
                {timeLeft > 0 ? (
                  <p className="text-sm text-gray-500">
                    Resend code in {timeLeft}s
                  </p>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={handleResend}
                    disabled={resendLoading}
                    className="text-strato-blue hover:text-strato-blue/80"
                  >
                    {resendLoading ? (
                      <span className="flex items-center">
                        <span className="mr-2 animate-spin">●</span>
                        Resending...
                      </span>
                    ) : (
                      <span className="flex items-center">
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Resend verification code
                      </span>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
            
            <CardFooter className="flex flex-col gap-4">
              <Button 
                onClick={handleConfirm}
                className="w-full bg-strato-blue hover:bg-strato-blue/90 text-white"
                disabled={loading || code.length !== 6}
              >
                {loading ? (
                  <span className="flex items-center">
                    <span className="mr-2 animate-spin">●</span>
                    Verifying...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    Verify Email <ArrowRight className="ml-2 h-4 w-4" />
                  </span>
                )}
              </Button>
              
              <div className="text-center">
                <p className="text-gray-600 text-sm">
                  Wrong email address?
                  <a 
                    href="/register" 
                    className="text-strato-blue hover:underline ml-1"
                  >
                    Go back to registration
                  </a>
                </p>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ConfirmEmail;
