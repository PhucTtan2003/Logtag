import React, { useEffect, useMemo, useState, useCallback } from "react";
import ChannelChart from "../components/ChannelChart";
import type { LiveWindow } from "../pages/User/userchart/types";

interface Props {
  baseSerial: string;
  channels: string[];
  liveMode: boolean;
  liveWindow: LiveWindow;
  histHours: number;
  forceTable: boolean;
}

function channelIndexLabel(ch: string) {
  const m = ch.match(/-CH(\d+)$/i)?.[1];
  return m ? `CH${m}` : ch;
}

export default function DevicePanel({
  baseSerial,
  channels,
  liveMode,
  liveWindow,
  histHours,
  forceTable,
}: Props) {
  
  const sortedChannels = useMemo(() => {
    const arr = [...(channels ?? [])];
    arr.sort((a, b) => {
      const ma = a.match(/-CH(\d+)$/i)?.[1];
      const mb = b.match(/-CH(\d+)$/i)?.[1];
      return (ma ? +ma : 0) - (mb ? +mb : 0);
    });
    return arr;
  }, [channels]);


  const [activeCh, setActiveCh] = useState<string>("");

 
  useEffect(() => {
    if (!sortedChannels.length) return;

    if (!activeCh || !sortedChannels.includes(activeCh)) {
      setActiveCh(sortedChannels[0]);
    }
  }, [sortedChannels, activeCh]);

  const activeIndex = useMemo(() => {
    const idx = sortedChannels.indexOf(activeCh);
    return idx >= 0 ? idx : 0;
  }, [sortedChannels, activeCh]);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < sortedChannels.length - 1;

  const goPrev = useCallback(() => {
    if (!canPrev) return;
    setActiveCh(sortedChannels[activeIndex - 1]);
  }, [canPrev, sortedChannels, activeIndex]);

  const goNext = useCallback(() => {
    if (!canNext) return;
    setActiveCh(sortedChannels[activeIndex + 1]);
  }, [canNext, sortedChannels, activeIndex]);

  if (!sortedChannels.length) return null;

  return (
    <section className="device-panel ios-card">
      <div className="device-header">
        <div className="device-title-row">
          <div className="device-title-main">
            <span className="device-chip">Thiết bị</span>
            <span className="device-serial">{baseSerial}</span>
          </div>

          <div className="device-subtitle">
            {sortedChannels.length} kênh được gán • LogTag
          </div>
        </div>

        {/* ✅ kênh switcher */}
        {sortedChannels.length > 1 && (
          <div className="device-channel-switch">
            <button
              type="button"
              className="device-chbtn"
              onClick={goPrev}
              disabled={!canPrev}
              title="Kênh trước"
            >
              ◀
            </button>

            <div className="device-chpills">
              {sortedChannels.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  className={"device-chpill" + (ch === activeCh ? " active" : "")}
                  onClick={() => setActiveCh(ch)}
                  title={ch}
                >
                  {channelIndexLabel(ch)}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="device-chbtn"
              onClick={goNext}
              disabled={!canNext}
              title="Kênh sau"
            >
              ▶
            </button>
          </div>
        )}
      </div>

      {/* ✅ chỉ render 1 ChannelChart đang active */}
      <div className="channel-stack">
        <ChannelChart
          key={activeCh || "ch"} // đổi kênh thì remount chart cho sạch state
          deviceId={activeCh || sortedChannels[0]}
          liveMode={liveMode}
          liveWindow={liveWindow}
          histHours={histHours}
          forceTable={forceTable}
          // ✅ cho fullscreen gọi next/prev
          channelIndex={activeIndex}
          channelCount={sortedChannels.length}
          onPrevChannel={goPrev}
          onNextChannel={goNext}
        />
      </div>
    </section>
  );
}
