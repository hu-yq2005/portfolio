import { useMemo, useState } from 'react';

type DayDatum = {
  dateLabel: string;
  screenMinutes: number;
};

function formatHM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export default function ScreenTimeClock() {
  const data = useMemo<DayDatum[]>(
    () => [
      { dateLabel: 'Feb 9', screenMinutes: 8 * 60 + 44 },
      { dateLabel: 'Feb 10', screenMinutes: 4 * 60 + 57 },
      { dateLabel: 'Feb 11', screenMinutes: 5 * 60 + 50 },
    ],
    []
  );

  const minutesPerDay = 24 * 60;
  const [index, setIndex] = useState(0);

  const current = data[index] ?? data[0]!;
  const fraction = Math.max(0, Math.min(1, current.screenMinutes / minutesPerDay));

  const size = 260;
  const radius = 92;
  const stroke = 22;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = fraction * circumference;

  function nextDay() {
    setIndex((prev) => (prev + 1) % data.length);
  }

  return (
    <div className="screenTimeClock" onClick={nextDay} role="button" tabIndex={0}>
      <div className="screenTimeClock__title">Screen Time as a “Day Clock”</div>

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Screen time clock">
        <g transform={`rotate(-90 ${center} ${center})`}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={stroke}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        </g>

        <text x={center} y={center - 6} textAnchor="middle" fontSize={22} fontWeight={750} fill="rgba(255,255,255,0.92)">
          {formatHM(current.screenMinutes)}
        </text>
        <text x={center} y={center + 18} textAnchor="middle" fontSize={12} fill="rgba(255,255,255,0.65)">
          {current.dateLabel} · {(fraction * 100).toFixed(1)}% of 24h
        </text>
      </svg>

      <div className="screenTimeClock__hint">Click the chart to switch day</div>
    </div>
  );
}
