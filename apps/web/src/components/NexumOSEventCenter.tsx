import { useEffect } from "react";

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
  useEffect(() => {
    const timers = events.map((event) => window.setTimeout(() => onDismiss(event.id), 5200));
    return () => timers.forEach(window.clearTimeout);
  }, [events, onDismiss]);

  if (!events.length) return null;

  return <div className="nexum-os-event-center" aria-live="polite">
    {events.map((event) => <div key={event.id} className={"nexum-os-event nexum-os-event-" + event.kind}>
      <div className="nexum-os-event-head">
        <strong><i className="nexum-os-event-dot" />{event.title}</strong>
        <button type="button" onClick={() => onDismiss(event.id)} aria-label="Закрыть уведомление">×</button>
      </div>
      <span>{event.message}</span>
    </div>)}
  </div>;
}