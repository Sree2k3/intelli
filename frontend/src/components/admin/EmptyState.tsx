import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center p-12 text-center card-elevated border border-dashed border-border/50 rounded-md bg-secondary/5"
    >
      <div className="h-16 w-16 rounded-md bg-secondary/50 flex items-center justify-center text-muted-foreground mb-6">
        <Icon size={32} />
      </div>
      <h3 className="text-xl font-bold tracking-tight mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-xs mb-8">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="hero">
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
}
