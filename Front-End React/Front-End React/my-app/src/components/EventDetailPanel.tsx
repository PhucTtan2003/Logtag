import React from "react";
import type { DbEvent } from "../lib/events/types";
import { formatYMDHMS, tzShort, relTime } from "../lib/events/format";
import { humanExplain } from "../lib/events/classify";

function cleanRepeatText(input?: string | null) {
  if (!input) return "";
  return String(input)
    .replace(/\s*,?\s*lặp\s+\d+\s+lần\.?/gi, "")
    .replace(/\s*,?\s*lập\s+\d+\s+lần\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default function EventDetailPanel({
  event,
  onClose,
}: {
  event: DbEvent | null;
  onClose: () => void;
}) {
  if (!event) return null;

  const info = humanExplain(event);
  const dt = new Date(event.eventTimeUtc);
  const utc = formatYMDHMS(dt, "UTC");
  const local = formatYMDHMS(dt);
  const localTz = tzShort(dt);

  const cleanedMeaning = cleanRepeatText(info.meaning);
  const visibleBullets = info.bullets.filter((b) => !/số lần liên tiếp/i.test(String(b.k || "")));

  return (
    <div className="ep-sheet" role="dialog" aria-modal="true">
      <div className="ep-sheet__backdrop" onClick={onClose} />
      <div className="ep-sheet__panel">
        <div className="ep-sheet__head">
          <div className="ep-titleRow">
            <span className="ep-emoji">{info.icon}</span>
            <span className="ep-titleText">{info.title}</span>
          </div>
          <button className="ep-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="ep-kv">
          <div><span className="ep-k">Thiết bị</span><span className="ep-v ep-tag">{event.serialNumber}</span></div>
          <div><span className="ep-k">Loại (gốc)</span>
            <span className={`ep-v ep-chip ${info.tone==="alarm"?"ep-chip--alarm":info.tone==="battery"?"ep-chip--battery":""}`}>
              {event.eventType}
            </span>
          </div>
          <div><span className="ep-k">Thời gian (địa phương)</span><span className="ep-v">{local} <span className="ep-tz">{localTz}</span></span></div>
          <div><span className="ep-k">Thời gian (UTC)</span><span className="ep-v ep-mono">{utc} UTC</span></div>
          <div><span className="ep-k">Khoảng thời gian</span><span className="ep-v">{relTime(event.eventTimeUtc)}</span></div>
        </div>

        {cleanedMeaning && (
          <>
            <div className="ep-subtitle">Ý nghĩa</div>
            <div className="ep-meaning">{cleanedMeaning}</div>
          </>
        )}

        {visibleBullets.length > 0 && (
          <>
            <div className="ep-subtitle">Chi tiết đo</div>
            <ul className="ep-ul">
              {visibleBullets.map((b, i) => (
                <li key={i}><b>{b.k}:</b> {b.v}</li>
              ))}
            </ul>
          </>
        )}

        {/* <details className="ep-details" style={{ marginTop: 10 }}>
          <summary>Dữ liệu gốc (dành cho kỹ thuật)</summary>
          <pre className="ep-pre">{JSON.stringify(event, null, 2)}</pre>
        </details> */}
      </div>
    </div>
  );
}
