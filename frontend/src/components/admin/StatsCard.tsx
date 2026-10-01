import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  color: string;
  delay?: number;
}

export function StatsCard({ title, value, icon: Icon, description, color, delay = 0 }: StatsCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="card-elevated p-6 relative overflow-hidden group"
    >
      <div className={`absolute top-0 right-0 p-8 -mr-4 -mt-4 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity`}>
        <Icon size={120} className={color} />
      </div>
      
      <div className="flex items-center gap-4 mb-4">
        <div className={`p-3 rounded-md bg-secondary/10 ${color}`}>
          <Icon size={24} />
        </div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
      </div>
      
      <div className="space-y-1">
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </motion.div>
  );
}
