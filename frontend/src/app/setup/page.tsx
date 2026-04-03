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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Welcome to Ship Dock</CardTitle>
          <CardDescription className="text-center">Create your admin account to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div><Label>Name</Label><Input {...register('name')} />{errors.name && <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>}</div>
            <div><Label>Email</Label><Input type="email" {...register('email')} />{errors.email && <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>}</div>
            <div><Label>Password</Label><Input type="password" {...register('password')} />{errors.password && <p className="text-sm text-red-500 mt-1">{errors.password.message}</p>}</div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Setting up...' : 'Create Account'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
