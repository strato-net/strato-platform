import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface GuestSignInPromptProps {
  title: string;
  description: string;
  buttonText?: string;
  cardTitle?: string;
  className?: string;
}

/**
 * Reusable component for guest sign-in prompts across the app.
 * Use this for consistent guest mode messaging.
 */
const GuestSignInPrompt: React.FC<GuestSignInPromptProps> = ({
  title,
  description,
  buttonText = "Sign In",
  cardTitle,
  className = "",
}) => {
  return (
    <Card className={className}>
      {cardTitle && (
        <CardHeader className="pb-3">
          <CardTitle className="text-lg md:text-xl">{cardTitle}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={cardTitle ? "px-3 md:px-6" : "text-center py-8 md:py-12"}>
        <div className={cardTitle ? "text-center py-12" : "max-w-md mx-auto"}>
          <h3 className="text-xl md:text-2xl font-semibold mb-3 md:mb-4">{title}</h3>
          <p className="text-muted-foreground mb-6 text-sm md:text-base max-w-md mx-auto">
            {description}
          </p>
          <Button asChild size="lg">
            <Link to="/login">{buttonText}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default GuestSignInPrompt;
