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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle className="text-2xl text-center">Ship Dock</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div><Label htmlFor="email">Email</Label><Input id="email" type="email" {...register('email')} />{errors.email && <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>}</div>
            <div><Label htmlFor="password">Password</Label><Input id="password" type="password" {...register('password')} />{errors.password && <p className="text-sm text-red-500 mt-1">{errors.password.message}</p>}</div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Logging in...' : 'Login'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
