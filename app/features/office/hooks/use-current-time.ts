"use client";

import { useEffect, useState } from "react";

import { OFFICE_COPY } from "../copy";

const TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

export function useCurrentTime(): string {
  const [currentTime, setCurrentTime] = useState<string>(OFFICE_COPY.header.clockFallback);

  useEffect(() => {
    const updateTime = () => setCurrentTime(TIME_FORMATTER.format(new Date()));
    updateTime();
    const intervalId = window.setInterval(updateTime, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return currentTime;
}
