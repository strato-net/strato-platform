import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/axios";
import { Loader2, CheckCircle2 } from "lucide-react";

export interface ContactInquiryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ContactInquiryModal = ({ open, onOpenChange }: ContactInquiryModalProps) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setMessage("");
      setSubmitted(false);
      setSubmitting(false);
    }
  }, [open]);

  const isValid = Boolean(name.trim() && email.trim() && message.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    try {
      await api.post("/contact", {
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
      });
      setSubmitted(true);
    } catch {
      // axios interceptor already shows error toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contact us</DialogTitle>
          <DialogDescription>
            Gold &amp; silver deposit inquiries and general questions. We&apos;ll reply by email.
          </DialogDescription>
        </DialogHeader>
        {submitted ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-sm text-muted-foreground text-center">
              Thanks — your message was sent. We&apos;ll reach you at{" "}
              <span className="font-medium text-foreground">{email}</span>.
            </p>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="contact-inquiry-name">Name</Label>
              <Input
                id="contact-inquiry-name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-inquiry-email">Email</Label>
              <Input
                id="contact-inquiry-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-inquiry-message">Message</Label>
              <Textarea
                id="contact-inquiry-message"
                placeholder="How can we help?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={5000}
                rows={4}
                required
              />
              <p className="text-xs text-muted-foreground text-right">{message.length}/5000</p>
            </div>
            <Button
              type="submit"
              disabled={!isValid || submitting}
              className="w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Inquiry"
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ContactInquiryModal;
