import { motion } from "framer-motion";

export function SkeletonCard() {
  return (
    <div className="card-elevated p-6 border border-border/50 rounded-md space-y-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-md bg-secondary/50" />
        <div className="h-4 w-24 bg-secondary/50 rounded" />
      </div>
      <div className="h-8 w-16 bg-secondary/50 rounded" />
      <div className="h-3 w-32 bg-secondary/50 rounded" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-border/30">
      <td className="px-6 py-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-md bg-secondary/30" />
          <div className="space-y-2">
            <div className="h-4 w-36 bg-secondary/30 rounded" />
            <div className="h-3 w-24 bg-secondary/20 rounded" />
          </div>
        </div>
      </td>
      <td className="px-6 py-6"><div className="h-5 w-24 bg-secondary/30 rounded" /></td>
      <td className="px-6 py-6">
        <div className="flex gap-4">
          <div className="h-8 w-10 bg-secondary/30 rounded" />
          <div className="h-8 w-10 bg-secondary/30 rounded" />
        </div>
      </td>
      <td className="px-6 py-6"><div className="h-4 w-16 bg-secondary/30 rounded" /></td>
      <td className="px-6 py-6 text-right">
        <div className="flex justify-end gap-2">
          <div className="h-9 w-9 rounded-md bg-secondary/30" />
          <div className="h-9 w-9 rounded-md bg-secondary/30" />
          <div className="h-9 w-9 rounded-md bg-secondary/30" />
        </div>
      </td>
    </tr>
  );
}

export function SkeletonChart() {
  return (
    <div className="h-[300px] w-full bg-secondary/10 rounded-md border border-border/30 flex items-end p-6 gap-2 animate-pulse">
      {[...Array(12)].map((_, i) => (
        <div 
          key={i} 
          className="bg-secondary/30 rounded-t w-full" 
          style={{ height: `${Math.random() * 80 + 20}%` }}
        />
      ))}
    </div>
  );
}
