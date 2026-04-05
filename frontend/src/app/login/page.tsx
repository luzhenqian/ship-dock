'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, setAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  useEffect(() => { api('/auth/status').then((data) => { if (data.needsSetup) router.push('/setup'); }).catch(() => {}); }, [router]);

  async function onSubmit(data: LoginForm) {
    try {
      setError('');
      const res = await api('/auth/login', { method: 'POST', body: JSON.stringify(data) });
      setAccessToken(res.accessToken);
      router.push('/dashboard');
    } catch (err: any) { setError(err.message); }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="w-full max-w-[340px] px-4">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-background">
              <path d="M12 2L2 19.5h20L12 2Z" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Ship Dock</h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[13px] text-foreground-secondary">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              {...register('email')}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-[13px] text-foreground-secondary">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <Button type="submit" className="h-9 w-full" disabled={isSubmitting}>
            {isSubmitting ? <><Loader2 className="size-3.5 animate-spin" /> Logging in...</> : 'Continue'}
          </Button>
        </form>
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 text-xs text-foreground-muted">
        Self-hosted deployment platform
      </div>
    </div>
  );
}
