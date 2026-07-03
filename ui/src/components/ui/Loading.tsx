import './Loading.css';

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Загрузка"
    />
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="ui-skeleton" role="status" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="ui-skeleton__line" />
      ))}
    </div>
  );
}
