'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, setAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

const setupSchema = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1) });
type SetupForm = z.infer<typeof setupSchema>;

export default function SetupPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SetupForm>({ resolver: zodResolver(setupSchema) });

  async function onSubmit(data: SetupForm) {
    try {
      setError('');
      const res = await api('/auth/setup', { method: 'POST', body: JSON.stringify(data) });
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
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-tight">Welcome to Ship Dock</h1>
            <p className="mt-1 text-[13px] text-foreground-muted">Create your admin account to get started.</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-[13px] text-foreground-secondary">Name</Label>
            <Input
              placeholder="Your name"
              autoComplete="name"
              autoFocus
              {...register('name')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] text-foreground-secondary">Email Address</Label>
            <Input
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] text-foreground-secondary">Password</Label>
            <Input
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
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
            {isSubmitting ? <><Loader2 className="size-3.5 animate-spin" /> Setting up...</> : 'Create Account'}
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
