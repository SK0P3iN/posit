import { FC, FormEvent, useState } from 'react';
import { useAuth } from '@gitroom/saas-mobile/context/auth.context';

export const LoginPage: FC = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col justify-center px-6 pt-safe-top pb-safe-bottom">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Postiz Mobile</h1>
        <p className="text-fifth mt-1 text-sm">
          Schedule and manage social posts on the go.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === 'register' && (
          <input
            className="w-full rounded-xl bg-input text-inputText px-4 py-3 outline-none border border-third"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        )}
        <input
          className="w-full rounded-xl bg-input text-inputText px-4 py-3 outline-none border border-third"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          className="w-full rounded-xl bg-input text-inputText px-4 py-3 outline-none border border-third"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-primary text-white py-3 font-medium disabled:opacity-60"
        >
          {submitting
            ? 'Please wait…'
            : mode === 'login'
            ? 'Sign in'
            : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-fifth"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login'
          ? 'Need an account? Register'
          : 'Already have an account? Sign in'}
      </button>
    </div>
  );
};
