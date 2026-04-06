import { cn } from "@/lib/utils";

const variants = { fast: "bg-fast-light text-fast-dark", slow: "bg-slow-light text-slow-dark", warn: "bg-warn-light text-amber-800", default: "bg-gray-100 text-gray-700" };

export function Badge({ children, variant = "default", className }: { children: React.ReactNode; variant?: keyof typeof variants; className?: string }) {
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", variants[variant], className)}>{children}</span>;
}
