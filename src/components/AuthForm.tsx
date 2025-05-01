
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { Shield, User, Lock, ArrowRight, Mail, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AuthFormProps {
  isRegister?: boolean;
}

interface FormValues {
  username?: string;
  password: string;
  confirmPassword?: string;
  email?: string;
  telegram?: string;
}

const AuthForm = ({ isRegister = false }: AuthFormProps) => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const form = useForm<FormValues>({
    defaultValues: {
      username: '',
      password: '',
      confirmPassword: '',
      email: '',
      telegram: '',
    },
  });
  
  const onSubmit = async (data: FormValues) => {
    setLoading(true);
    try {
      // For demo purposes, we'll simulate a successful registration/login
      setTimeout(() => {
        if (isRegister) {
          toast({
            title: "Account created",
            description: "You can now log in to your account",
          });
          navigate('/login');
        } else {
          toast({
            title: "Welcome back",
            description: "You've been logged in successfully",
          });
          navigate('/dashboard');
        }
        setLoading(false);
      }, 1500);
    } catch (error) {
      setLoading(false);
      toast({
        title: "Error",
        description: "An error occurred. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="mb-8 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-r from-strato-blue to-strato-purple flex items-center justify-center">
            <Shield className="h-8 w-8 text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-2">
          {isRegister ? 'Create Your STRATO Mercata Wallet' : 'Welcome back'}
        </h1>
        <p className="text-gray-600">
          {isRegister 
            ? 'Join the future of vaulted assets on-chain' 
            : 'Log in to access your STRATO Mercata account'}
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {isRegister && (
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                      <Input className="pl-10" placeholder="johndoe" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <Input className="pl-10" type="password" placeholder="••••••••" {...field} />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          {isRegister && (
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                      <Input className="pl-10" type="password" placeholder="••••••••" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          
          {!isRegister ? (
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                      <Input className="pl-10" placeholder="your@email.com" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (optional)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                        <Input className="pl-10" placeholder="your@email.com" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="telegram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telegram (optional)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <MessageSquare className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                        <Input className="pl-10" placeholder="@username" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
          
          <Button 
            type="submit" 
            className="w-full bg-strato-blue hover:bg-strato-blue/90 text-white" 
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center">
                <span className="mr-2 animate-spin">●</span>
                {isRegister ? 'Creating account...' : 'Logging in...'}
              </span>
            ) : (
              <span className="flex items-center justify-center">
                {isRegister ? 'Create Account' : 'Log In'} 
                <ArrowRight className="ml-2 h-4 w-4" />
              </span>
            )}
          </Button>
          
          <div className="text-center mt-6">
            <p className="text-gray-600">
              {isRegister ? 'Already have an account?' : "Don't have an account?"}
              <a 
                href={isRegister ? '/login' : '/register'} 
                className="text-strato-blue hover:underline ml-1"
              >
                {isRegister ? 'Log In' : 'Sign Up'}
              </a>
            </p>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default AuthForm;
