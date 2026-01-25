'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OAuthButtons } from './oauth-buttons';

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');

  const [isLoading, setIsLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setFormError(null);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        callbackUrl,
        redirect: false,
      });

      if (result?.error) {
        setFormError('Invalid email or password');
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setFormError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Error messages */}
      {(error || formError) && (
        <div className="p-3 border border-destructive/30 rounded text-sm text-destructive">
          {formError || 'Authentication failed. Please try again.'}
        </div>
      )}

      {/* OAuth Buttons */}
      <OAuthButtons callbackUrl={callbackUrl} />

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border/50" />
        </div>
        <div className="relative flex justify-center">
          <button
            type="button"
            onClick={() => setShowEmailForm(!showEmailForm)}
            className="bg-background px-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showEmailForm ? 'Hide' : 'Or continue with email'}
          </button>
        </div>
      </div>

      {/* Email/Password Form */}
      {showEmailForm && (
        <form onSubmit={handleCredentialsSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="label-xs">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="label-xs">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
