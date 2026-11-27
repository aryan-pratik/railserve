import type { ReactNode } from 'react'
import { TrainFront, ChefHat, Bike } from 'lucide-react'

/**
 * The frame around sign-in and joining: a dark green brand panel beside a
 * white card on the grey canvas. The panel's line and points can change; the
 * card holds the form.
 */
export function AuthFrame({ headline = 'Food on the train, on time, every halt.', points, children, wide = false }: { headline?: string; points?: ReactNode[]; children: ReactNode; wide?: boolean }) {
  const list = points ?? [
    <><TrainFront size={18} className="text-v2-mint" aria-hidden /> Live arrivals and leave-by times for every run</>,
    <><ChefHat size={18} className="text-v2-mint" aria-hidden /> One kitchen board from new order to hand-over</>,
    <><Bike size={18} className="text-v2-mint" aria-hidden /> Riders, cash and returns in one place</>,
  ]
  return (
    <main className="grid min-h-dvh place-items-center bg-v2-bg p-4 font-v2 text-v2-ink antialiased">
      <div className={`grid w-full overflow-hidden rounded-v2-2xl bg-v2-frame shadow-v2-frame md:grid-cols-[1fr_1.1fr] ${wide ? 'max-w-[1000px]' : 'max-w-[920px] md:grid-cols-[1.1fr_1fr]'}`}>
        <section className="relative hidden overflow-hidden bg-v2-brand-deep p-10 text-white md:grid md:content-between">
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_40%_40%,rgba(143,220,180,0.5),rgba(143,220,180,0)_62%)]"
          />
          <div className="flex items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.02em]">
            <span className="relative inline-block h-[30px] w-[30px] rounded-[9px] bg-white/15" aria-hidden>
              <span className="absolute left-[7px] right-[7px] top-[9px] h-[3px] rounded bg-v2-mint" />
              <span className="absolute left-[7px] right-[11px] top-[17px] h-[3px] rounded bg-v2-mint" />
            </span>
            RailServe
          </div>
          <div className="relative grid gap-6">
            <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-balance">{headline}</h1>
            <ul className="grid gap-3 text-sm text-white/85">
              {list.map((p, i) => (
                <li key={i} className="flex items-center gap-3">
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-white/60">Train food delivery operations</p>
        </section>

        <section className="grid content-center gap-6 p-8 sm:p-10">
          <div className="md:hidden">
            <div className="text-[22px] font-extrabold tracking-[-0.02em]">RailServe</div>
          </div>
          {children}
        </section>
      </div>
    </main>
  )
}
