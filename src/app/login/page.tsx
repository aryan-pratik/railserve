import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · RailServe' }

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Rail<span className="text-accent">Serve</span>
          </h1>
          <p className="mt-1 text-sm text-muted">Train food delivery operations</p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
