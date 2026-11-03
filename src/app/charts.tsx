"use client";

export const VOICE_COLORS = ["#4d6a10", "#e0709a", "#5b6fd6", "#c98a10", "#2f9e8f", "#8a5cc7"];

export const colorFor = (index: number) => VOICE_COLORS[index % VOICE_COLORS.length];

export interface CallDot {
  voice: string;
  color: string;
  p: number;
  weight: number;
}

/** A horizontal 0-100% track: every voice's call as a dot sized by credibility, plus the two consensus markers. */
export function ConsensusTrack({ dots, weighted, naive }: { dots: CallDot[]; weighted: number | null; naive: number | null }) {
  return (
    <div className="track-wrap">
      <div className="track-line">
        {[0, 25, 50, 75, 100].map((t) => (
          <i key={t} className="tick" style={{ left: `${t}%` }} />
        ))}
        {naive !== null && (
          <span className="mark naive" style={{ left: `${naive * 100}%` }} title={`Simple average ${(naive * 100).toFixed(1)}%`}>
            <em>simple avg {(naive * 100).toFixed(0)}%</em>
          </span>
        )}
        {weighted !== null && (
          <span className="mark weighted" style={{ left: `${weighted * 100}%` }} title={`Trust-weighted ${(weighted * 100).toFixed(1)}%`}>
            <em>trust-weighted {(weighted * 100).toFixed(0)}%</em>
          </span>
        )}
        {dots.map((d, i) => {
          const size = 12 + Math.min(3, d.weight) * 5;
          return (
            <b
              key={`${d.voice}-${i}`}
              className="dot"
              style={{ left: `${d.p * 100}%`, width: size, height: size, background: d.color }}
              title={`${d.voice}: ${(d.p * 100).toFixed(0)}% (weight ${d.weight.toFixed(2)})`}
            />
          );
        })}
      </div>
      <div className="track-axis">
        <span>says NO</span>
        <span>50/50</span>
        <span>says YES</span>
      </div>
    </div>
  );
}

/** Tiny line of a voice's weight over resolved markets. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 84;
  const h = 26;
  const pts = [1, ...values];
  if (pts.length < 2) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden />;
  const max = Math.max(3, ...pts);
  const x = (i: number) => (i / (pts.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - (v / max) * (h - 6);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="2.6" fill={color} />
    </svg>
  );
}

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Credibility over time: one line per voice, starting at neutral 1.0 before any market resolves. */
export function WeightChart({ series, labels }: { series: Series[]; labels: string[] }) {
  const w = 560;
  const h = 210;
  const padL = 30;
  const padB = 22;
  const n = labels.length + 1;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (w - padL - 12);
  const y = (v: number) => 10 + (1 - v / 3) * (h - padB - 14);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Credibility weight of each voice after each resolved market">
      {[0, 1, 2, 3].map((t) => (
        <g key={t}>
          <line x1={padL} x2={w - 8} y1={y(t)} y2={y(t)} className={t === 1 ? "grid base" : "grid"} />
          <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" className="axis">
            {t}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={i} x={x(i + 1)} y={h - 6} textAnchor="middle" className="axis">
          {i + 1}
          <title>{l}</title>
        </text>
      ))}
      {series.map((s) => {
        const pts = [1, ...s.values];
        const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
        return (
          <g key={s.name}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === pts.length - 1 ? 4 : 2.4} fill={s.color}>
                <title>{`${s.name}: ${v.toFixed(2)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
