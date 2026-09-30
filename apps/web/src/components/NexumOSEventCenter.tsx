import { useEffect, useRef } from "react";

export type NexumOSEventKind = "info" | "success" | "error";

export interface NexumOSEventItem {
  id: number;
  kind: NexumOSEventKind;
  title: string;
  message: string;
}

interface Props {
  events: NexumOSEventItem[];
  onDismiss: (id: number) => void;
}

export function NexumOSEventCenter({ events, onDismiss }: Props) {
  const timersRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    const activeIds = new Set(events.map((event) => event.id));

    for (const event of events) {
      if (timers.has(event.id)) continue;
      timers.set(event.id, window.setTimeout(() => {
        timers.delete(event.id);
        onDismiss(event.id);
      }, 5200));
    }

    for (const [id, timer] of timers) {
      if (!activeIds.has(id)) {
        window.clearTimeout(timer);
        timers.delete(id);
      }
    }

    return () => {
      // Keep timers alive between renders so adding a new event does not
      // reset the lifetime of notifications that are already visible.
    };
  }, [events, onDismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  if (!events.length) return null;

  return <div className="nexum-os-event-center" aria-label="NEXUM notifications">
    {events.map((event) => <div key={event.id} className={"nexum-os-event nexum-os-event-" + event.kind} role={event.kind === "error" ? "alert" : "status"} aria-live={event.kind === "error" ? "assertive" : "polite"}>
      <div className="nexum-os-event-head">
        <strong><i className="nexum-os-event-dot" />{event.title}</strong>
        <button type="button" onClick={() => onDismiss(event.id)} aria-label="Закрыть уведомление">×</button>
      </div>
      <span>{event.message}</span>
    </div>)}
  </div>;
}