
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Share, UserPlus, X } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

interface ShareTheWealthProps {
  onShare: (emailsSent: number) => void;
  assets: {
    usdst: number;
    goldst: number;
    cata: number;
    borrowed: number;
  };
  isMobile: boolean;
}

// Define form schema
const formSchema = z.object({
  emails: z.array(z.string().email("Please enter a valid email address")).min(0).max(5)
});

type FormValues = z.infer<typeof formSchema>;

const ShareTheWealth: React.FC<ShareTheWealthProps> = ({ onShare, assets, isMobile }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [currentEmail, setCurrentEmail] = useState("");
  const { toast } = useToast();
  
  const referralLink = `${window.location.origin}/register?ref=user123`;
  
  // Form setup
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      emails: []
    }
  });

  useEffect(() => {
    // Animate in with a slight delay
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 300);

    return () => clearTimeout(timer);
  }, []);
  
  const handleAddEmail = () => {
    if (!currentEmail || emails.length >= 5) return;
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(currentEmail)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address",
        variant: "destructive"
      });
      return;
    }
    
    if (emails.includes(currentEmail)) {
      toast({
        title: "Email already added",
        description: "This email has already been added to your referrals",
        variant: "destructive"
      });
      return;
    }
    
    setEmails([...emails, currentEmail]);
    setCurrentEmail("");
  };
  
  const handleRemoveEmail = (email: string) => {
    setEmails(emails.filter(e => e !== email));
  };
  
  const handleSendReferrals = () => {
    toast({
      title: "Referrals sent!",
      description: `${emails.length} friend${emails.length !== 1 ? 's' : ''} invited to STRATO Mercata.`,
    });
    onShare(emails.length);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast({
      title: "Referral link copied!",
      description: "Share it with friends to earn CATA rewards."
    });
  };

  const skipReferrals = () => {
    onShare(0);
  };

  return (
    <div className={`relative w-full max-w-md transition-all duration-500 transform ${
      isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
    }`}>
      <Card className={`shadow-lg border-2 border-strato-blue/20 ${
        isMobile ? 'mx-auto' : ''
      }`}>
        <CardHeader className="border-b">
          <CardTitle className="text-xl text-center flex items-center justify-center gap-2">
            <Share size={20} className="text-strato-purple" />
            Share the Wealth
          </CardTitle>
        </CardHeader>
        
        <CardContent className="pt-6 space-y-4">
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
            <p className="text-purple-800 text-sm">
              Invite friends to STRATO Mercata and earn <span className="font-bold">1 CATA</span> for each friend who signs up!
            </p>
          </div>
          
          <div className="space-y-1">
            <Label htmlFor="referral-link" className="text-sm font-medium">Your referral link</Label>
            <div className="flex gap-2">
              <Input 
                id="referral-link"
                value={referralLink} 
                readOnly 
                className="text-sm bg-gray-50"
              />
              <Button 
                onClick={handleCopyLink} 
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                Copy
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <UserPlus size={16} className="text-strato-purple" />
              <Label className="font-medium">Invite friends by email</Label>
              <span className="text-xs text-gray-500 ml-auto">{emails.length}/5</span>
            </div>
            
            <div className="flex gap-2">
              <Input
                value={currentEmail}
                onChange={(e) => setCurrentEmail(e.target.value)}
                placeholder="friend@example.com"
                className="flex-1"
                disabled={emails.length >= 5}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddEmail();
                  }
                }}
              />
              <Button 
                onClick={handleAddEmail} 
                variant="default"
                disabled={emails.length >= 5 || !currentEmail}
                className="shrink-0"
              >
                Add
              </Button>
            </div>
            
            {emails.length > 0 && (
              <div className="space-y-2 mt-2">
                {emails.map((email, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="text-gray-400" />
                      <span className="text-sm truncate">{email}</span>
                    </div>
                    <Button 
                      onClick={() => handleRemoveEmail(email)} 
                      variant="ghost" 
                      size="sm"
                      className="h-6 w-6 p-0"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            
            {emails.length === 0 && (
              <div className="text-center py-3 text-sm text-gray-500">
                No emails added yet
              </div>
            )}
          </div>
          
          <div className="bg-green-50 rounded-lg p-3 border border-green-100">
            <div className="flex items-center text-sm text-green-700 gap-1">
              <span>Potential earnings:</span>
              <span className="font-medium">{emails.length} CATA</span>
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="border-t p-4 flex justify-between">
          <Button 
            onClick={skipReferrals}
            variant="ghost"
            className="text-gray-500"
          >
            Skip
          </Button>
          <Button 
            onClick={handleSendReferrals}
            disabled={emails.length === 0}
            className="bg-strato-purple hover:bg-strato-purple/90 text-white font-semibold px-6"
          >
            Send Invites
          </Button>
        </CardFooter>
      </Card>
      
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 py-4 px-4 bg-gradient-to-t from-gray-50 to-transparent flex justify-between">
          <Button 
            onClick={skipReferrals}
            variant="outline"
            className="w-1/3"
          >
            Skip
          </Button>
          <Button 
            onClick={handleSendReferrals}
            disabled={emails.length === 0}
            className="bg-strato-purple hover:bg-strato-purple/90 text-white font-semibold w-2/3 ml-2"
          >
            Send Invites
          </Button>
        </div>
      )}
    </div>
  );
};

export default ShareTheWealth;
