import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · RailServe' }

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">RailServe</h1>
          <p className="mt-1 text-sm text-slate-500">Train food delivery operations</p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
