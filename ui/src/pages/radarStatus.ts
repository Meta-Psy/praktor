export interface RadarItem {
  full_name: string;
  name: string;
  description: string;
  html_url: string;
  stars: number;
  topic: string;
  pushed_at?: string;
  first_seen: string;
  is_new: boolean;
}

export interface RadarResponse {
  items: RadarItem[];
}

// formatStars renders a star count compactly (1500 → "1.5k").
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
