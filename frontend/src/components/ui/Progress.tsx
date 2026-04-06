import { cn } from "@/lib/utils";

export function Progress({ value, max = 100, color = "bg-fast", className }: { value: number; max?: number; color?: string; className?: string }) {
  const percent = Math.min(100, (value / max) * 100);
  return (
    <div className={cn("w-full bg-gray-200 rounded-full h-2", className)}>
      <div className={cn("h-2 rounded-full transition-all duration-500", color)} style={{ width: `${percent}%` }} />
    </div>
  );
}
